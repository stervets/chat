import {createHash, randomUUID} from 'node:crypto';
import {existsSync, readdirSync, readFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {Client} from 'pg';
import {config} from '../config.js';

const META_TABLE = 'nodes_migration_meta';
const LEGACY_USED_INVITES_TABLE = 'migration_legacy_invite_usage';

function connectionString() {
  return process.env.DATABASE_URL || config.db.url;
}

function logStep(message: string) {
  process.stdout.write(`${message}\n`);
}

function quoteIdent(value: string) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

function shortHash(value: string) {
  return createHash('sha1').update(value).digest('hex').slice(0, 8);
}

function legacyIdentifier(baseName: string, salt: string) {
  const suffix = `_legacy_${shortHash(`${salt}:${baseName}`)}`;
  const maxBaseLength = 63 - suffix.length;
  return `${baseName.slice(0, Math.max(1, maxBaseLength))}${suffix}`;
}

function backendDir() {
  const scriptDir = fileURLToPath(new URL('.', import.meta.url));
  return resolve(scriptDir, '..', '..');
}

async function tableExists(client: Client, tableName: string) {
  const result = await client.query(
    `select exists (
       select 1
       from information_schema.tables
       where table_schema = 'public'
         and table_name = $1
     ) as ok`,
    [tableName],
  );
  return !!result.rows[0]?.ok;
}

async function columnExists(client: Client, tableName: string, columnName: string) {
  const result = await client.query(
    `select exists (
       select 1
       from information_schema.columns
       where table_schema = 'public'
         and table_name = $1
         and column_name = $2
     ) as ok`,
    [tableName, columnName],
  );
  return !!result.rows[0]?.ok;
}

async function typeExists(client: Client, typeName: string) {
  const result = await client.query(
    `select exists (
       select 1
       from pg_type t
       join pg_namespace n on n.oid = t.typnamespace
       where n.nspname = 'public'
         and t.typname = $1
     ) as ok`,
    [typeName],
  );
  return !!result.rows[0]?.ok;
}

async function scalarInt(client: Client, sql: string) {
  const result = await client.query(sql);
  return Number(result.rows[0]?.value || 0);
}

async function ensureEnum(client: Client, typeName: string, values: string[]) {
  if (await typeExists(client, typeName)) return;
  const enumValues = values.map((value) => `'${value.replace(/'/g, "''")}'`).join(', ');
  await client.query(`create type ${quoteIdent(typeName)} as enum (${enumValues})`);
}

async function ensureLegacySchema(client: Client) {
  const hasRooms = await tableExists(client, 'rooms');
  const hasMessages = await tableExists(client, 'messages');
  const hasRoomId = hasMessages ? await columnExists(client, 'messages', 'room_id') : false;

  if (!hasRooms || !hasMessages || !hasRoomId) {
    throw new Error('legacy_schema_not_detected: expected public.rooms, public.messages and messages.room_id');
  }
}

async function alreadyMigrated(client: Client) {
  if (await tableExists(client, META_TABLE)) return true;

  const hasNodes = await tableExists(client, 'nodes');
  if (!hasNodes) return false;

  const hasMessages = await tableExists(client, 'messages');
  const hasLegacyRoomId = hasMessages ? await columnExists(client, 'messages', 'room_id') : false;
  return hasMessages && !hasLegacyRoomId;
}

async function renameOwnedSequence(client: Client, legacyTableName: string, columnName: string) {
  const result = await client.query(
    `select pg_get_serial_sequence($1, $2) as sequence_name`,
    [`public.${legacyTableName}`, columnName],
  );
  const sequenceNameRaw = String(result.rows[0]?.sequence_name || '').trim();
  if (!sequenceNameRaw) return;

  const sequenceName = sequenceNameRaw.includes('.')
    ? sequenceNameRaw.split('.').pop()!
    : sequenceNameRaw;
  const nextName = legacyIdentifier(sequenceName, `${legacyTableName}.${columnName}`);
  if (sequenceName === nextName) return;
  await client.query(`alter sequence ${quoteIdent(sequenceName)} rename to ${quoteIdent(nextName)}`);
}

async function renameIndexesForTable(client: Client, tableName: string) {
  const result = await client.query(
    `select index_class.relname as index_name
     from pg_index index_info
     join pg_class table_class on table_class.oid = index_info.indrelid
     join pg_namespace table_namespace on table_namespace.oid = table_class.relnamespace
     join pg_class index_class on index_class.oid = index_info.indexrelid
     where table_namespace.nspname = 'public'
       and table_class.relname = $1
     order by index_class.relname`,
    [tableName],
  );

  for (const row of result.rows) {
    const indexName = String(row.index_name || '').trim();
    if (!indexName) continue;
    const nextName = legacyIdentifier(indexName, tableName);
    if (nextName === indexName) continue;
    await client.query(`alter index ${quoteIdent(indexName)} rename to ${quoteIdent(nextName)}`);
  }
}

async function renameTableIfExists(client: Client, tableName: string) {
  if (!await tableExists(client, tableName)) return false;

  const legacyName = `${tableName}_legacy`;
  if (await tableExists(client, legacyName)) {
    throw new Error(`legacy_table_already_exists:${legacyName}`);
  }

  await client.query(`alter table ${quoteIdent(tableName)} rename to ${quoteIdent(legacyName)}`);
  await renameIndexesForTable(client, legacyName);
  await renameOwnedSequence(client, legacyName, 'id');
  return true;
}

async function renameLegacyTables(client: Client) {
  const tables = [
    'graph_edges',
    'graph_nodes',
    'rooms_users',
    'message_reactions',
    'game_session_players',
    'game_sessions',
    'messages',
    'rooms',
  ];

  for (const tableName of tables) {
    await renameTableIfExists(client, tableName);
  }
}

async function ensureUserAndInviteShape(client: Client) {
  logStep('Updating users/invites shape...');

  await client.query(`alter table users add column if not exists avatar_path text`);

  await client.query(`
    create table if not exists ${quoteIdent(LEGACY_USED_INVITES_TABLE)} (
      legacy_invite_id integer primary key,
      code varchar(64) not null,
      created_by integer,
      created_at timestamptz(3),
      used_by integer,
      used_at timestamptz(3),
      expires_at timestamptz(3),
      archived_at timestamptz(3) not null default now()
    )
  `);

  const hasUsedBy = await columnExists(client, 'invites', 'used_by');
  const hasUsedAt = await columnExists(client, 'invites', 'used_at');
  if (hasUsedBy || hasUsedAt) {
    const usedWhere = [
      hasUsedBy ? 'used_by is not null' : null,
      hasUsedAt ? 'used_at is not null' : null,
    ].filter(Boolean).join(' or ');

    await client.query(`
      insert into ${quoteIdent(LEGACY_USED_INVITES_TABLE)} (
        legacy_invite_id,
        code,
        created_by,
        created_at,
        used_by,
        used_at,
        expires_at
      )
      select
        id,
        code,
        created_by,
        created_at,
        ${hasUsedBy ? 'used_by' : 'null::integer'},
        ${hasUsedAt ? 'used_at' : 'null::timestamptz'},
        expires_at
      from invites
      where ${usedWhere}
      on conflict (legacy_invite_id) do update set
        code = excluded.code,
        created_by = excluded.created_by,
        created_at = excluded.created_at,
        used_by = excluded.used_by,
        used_at = excluded.used_at,
        expires_at = excluded.expires_at
    `);

    await client.query(`delete from invites where ${usedWhere}`);
  }

  await client.query(`alter table invites drop constraint if exists invites_used_by_fkey`);
  await client.query(`alter table invites drop column if exists used_by, drop column if exists used_at`);
}

async function createNewSchema(client: Client) {
  await ensureEnum(client, 'GameSessionStatus', ['lobby', 'active', 'finished', 'cancelled']);
  await ensureEnum(client, 'GameSessionVisibility', ['solo', 'public', 'invite_only']);
  await ensureEnum(client, 'GameSessionPlayerKind', ['human', 'bot']);

  await client.query(`
    create table nodes (
      id integer generated by default as identity primary key,
      parent_id integer references nodes(id) on delete cascade,
      type varchar(64) not null,
      component varchar(160),
      client_script varchar(160),
      server_script varchar(160),
      data jsonb not null default '{}'::jsonb,
      created_by integer references users(id) on delete set null,
      created_at timestamptz(3) not null default now()
    )
  `);

  await client.query(`
    create table rooms (
      id integer primary key references nodes(id) on delete cascade,
      kind varchar(64) not null,
      title text,
      visibility varchar(16) not null default 'public',
      comments_enabled boolean not null default true,
      avatar_path text,
      post_only_by_admin boolean not null default false,
      pinned_node_id integer references nodes(id) on delete set null
    )
  `);

  await client.query(`
    create table messages (
      id integer primary key references nodes(id) on delete cascade,
      sender_id integer references users(id) on delete set null,
      kind varchar(64) not null,
      raw_text text not null,
      rendered_html text not null,
      created_at timestamptz(3) not null default now()
    )
  `);

  await client.query(`
    create table rooms_users (
      room_id integer not null references rooms(id) on delete cascade,
      user_id integer not null references users(id) on delete cascade,
      joined_at timestamptz(3) not null default now(),
      primary key (room_id, user_id)
    )
  `);

  await client.query(`
    create table message_reactions (
      id integer generated by default as identity primary key,
      message_id integer not null references messages(id) on delete cascade,
      user_id integer not null references users(id) on delete cascade,
      reaction varchar(32) not null,
      created_at timestamptz(3) not null default now()
    )
  `);

  await client.query(`
    create table game_sessions (
      id integer generated by default as identity primary key,
      room_id integer not null references rooms(id) on delete cascade,
      module_key varchar(64) not null,
      status ${quoteIdent('GameSessionStatus')} not null,
      visibility ${quoteIdent('GameSessionVisibility')} not null,
      created_by integer references users(id) on delete set null,
      created_at timestamptz(3) not null default now(),
      started_at timestamptz(3),
      finished_at timestamptz(3),
      settings_json jsonb not null,
      state_json jsonb not null
    )
  `);

  await client.query(`
    create table game_session_players (
      session_id integer not null references game_sessions(id) on delete cascade,
      user_id integer not null references users(id) on delete cascade,
      seat integer not null,
      kind ${quoteIdent('GameSessionPlayerKind')} not null,
      joined_at timestamptz(3) not null default now(),
      is_ready boolean not null default true,
      primary key (session_id, user_id)
    )
  `);

  await client.query(`
    create table invites_rooms (
      invite_id integer not null references invites(id) on delete cascade,
      room_id integer not null references rooms(id) on delete cascade,
      primary key (invite_id, room_id)
    )
  `);

  await client.query(`
    create table users_contacts (
      owner_id integer not null references users(id) on delete cascade,
      contact_id integer not null references users(id) on delete cascade,
      created_at timestamptz(3) not null default now(),
      primary key (owner_id, contact_id)
    )
  `);

  await client.query(`create unique index game_session_players_session_seat_key on game_session_players(session_id, seat)`);
  await client.query(`create index nodes_parent_idx on nodes(parent_id)`);
  await client.query(`create index nodes_type_idx on nodes(type)`);
  await client.query(`create index nodes_parent_type_id_desc_idx on nodes(parent_id, type, id desc)`);
  await client.query(`create index rooms_kind_idx on rooms(kind)`);
  await client.query(`create index rooms_pinned_node_idx on rooms(pinned_node_id)`);
  await client.query(`create index rooms_users_user_idx on rooms_users(user_id)`);
  await client.query(`create index messages_sender_idx on messages(sender_id)`);
  await client.query(`create index messages_created_desc_idx on messages(created_at desc)`);
  await client.query(`create unique index message_reactions_unique on message_reactions(message_id, user_id)`);
  await client.query(`create index message_reactions_message_idx on message_reactions(message_id, reaction)`);
  await client.query(`create index game_sessions_room_idx on game_sessions(room_id)`);
  await client.query(`create index game_sessions_module_status_idx on game_sessions(module_key, status)`);
  await client.query(`create index game_session_players_user_idx on game_session_players(user_id)`);
  await client.query(`create index invites_rooms_room_id_idx on invites_rooms(room_id)`);
  await client.query(`create index users_contacts_contact_id_idx on users_contacts(contact_id)`);
}

async function migrateData(client: Client) {
  const roomColumns = {
    scriptId: await columnExists(client, 'rooms_legacy', 'script_id'),
    scriptMode: await columnExists(client, 'rooms_legacy', 'script_mode'),
    scriptRevision: await columnExists(client, 'rooms_legacy', 'script_revision'),
    scriptConfigJson: await columnExists(client, 'rooms_legacy', 'script_config_json'),
    scriptStateJson: await columnExists(client, 'rooms_legacy', 'script_state_json'),
    pinnedMessageId: await columnExists(client, 'rooms_legacy', 'pinned_message_id'),
    visibility: await columnExists(client, 'rooms_legacy', 'visibility'),
    commentsEnabled: await columnExists(client, 'rooms_legacy', 'comments_enabled'),
    avatarPath: await columnExists(client, 'rooms_legacy', 'avatar_path'),
    postOnlyByAdmin: await columnExists(client, 'rooms_legacy', 'post_only_by_admin'),
    appEnabled: await columnExists(client, 'rooms_legacy', 'app_enabled'),
    appType: await columnExists(client, 'rooms_legacy', 'app_type'),
    appConfigJson: await columnExists(client, 'rooms_legacy', 'app_config_json'),
  };
  const messageColumns = {
    scriptId: await columnExists(client, 'messages_legacy', 'script_id'),
    scriptMode: await columnExists(client, 'messages_legacy', 'script_mode'),
    scriptRevision: await columnExists(client, 'messages_legacy', 'script_revision'),
    scriptConfigJson: await columnExists(client, 'messages_legacy', 'script_config_json'),
    scriptStateJson: await columnExists(client, 'messages_legacy', 'script_state_json'),
    discussionRoomId: await columnExists(client, 'messages_legacy', 'discussion_room_id'),
  };

  const roomScriptId = roomColumns.scriptId ? `nullif(lower(btrim(r.script_id::text)), '')` : `null::text`;
  const roomScriptMode = roomColumns.scriptMode ? `r.script_mode::text` : `null::text`;
  const roomScriptRevision = roomColumns.scriptRevision ? `coalesce(r.script_revision, 0)` : `0`;
  const roomScriptConfig = roomColumns.scriptConfigJson ? `coalesce(r.script_config_json::jsonb, '{}'::jsonb)` : `'{}'::jsonb`;
  const roomScriptState = roomColumns.scriptStateJson ? `coalesce(r.script_state_json::jsonb, '{}'::jsonb)` : `'{}'::jsonb`;
  const roomAppEnabled = roomColumns.appEnabled ? `coalesce(r.app_enabled, false)` : `false`;
  const roomAppType = roomColumns.appType ? `r.app_type::text` : `null::text`;
  const roomAppConfig = roomColumns.appConfigJson ? `coalesce(r.app_config_json::jsonb, '{}'::jsonb)` : `'{}'::jsonb`;
  const roomSurfaceData = (roomColumns.appEnabled || roomColumns.appType || roomColumns.appConfigJson)
    ? `case
         when ${roomAppEnabled}
           or ${roomAppType} is not null
           or ${roomAppConfig} <> '{}'::jsonb
         then jsonb_build_object(
           'enabled', ${roomAppEnabled},
           'type', ${roomAppType},
           'config', ${roomAppConfig}
         )
         else null
       end`
    : `null::jsonb`;

  const messageScriptId = messageColumns.scriptId ? `nullif(lower(btrim(m.script_id::text)), '')` : `null::text`;
  const messageScriptMode = messageColumns.scriptMode ? `m.script_mode::text` : `null::text`;
  const messageScriptRevision = messageColumns.scriptRevision ? `coalesce(m.script_revision, 0)` : `0`;
  const messageScriptConfig = messageColumns.scriptConfigJson ? `coalesce(m.script_config_json::jsonb, '{}'::jsonb)` : `'{}'::jsonb`;
  const messageScriptState = messageColumns.scriptStateJson ? `coalesce(m.script_state_json::jsonb, '{}'::jsonb)` : `'{}'::jsonb`;

  await client.query(`create temp table room_id_map (old_room_id integer primary key, new_node_id integer not null unique) on commit drop`);
  await client.query(`create temp table message_id_map (old_message_id integer primary key, new_node_id integer not null unique) on commit drop`);

  await client.query(`
    insert into room_id_map (old_room_id, new_node_id)
    select id, id
    from rooms_legacy
    order by id
  `);

  await client.query(`
    insert into message_id_map (old_message_id, new_node_id)
    select
      legacy_message.id,
      (select coalesce(max(new_node_id), 0) from room_id_map)
        + (row_number() over (order by legacy_message.id asc))::integer
    from messages_legacy legacy_message
    order by legacy_message.id
  `);

  logStep('Migrating room nodes...');
  await client.query(`
    insert into nodes (id, parent_id, type, component, client_script, server_script, data, created_by, created_at)
    select
      room_map.new_node_id,
      null,
      'room',
      null,
      ${roomScriptId},
      case
        when ${roomScriptMode} = 'client_server' and ${roomScriptId} is not null then ${roomScriptId}
        else null
      end,
      jsonb_strip_nulls(jsonb_build_object(
        'scriptMode', case when ${roomScriptId} is not null then ${roomScriptMode} else null end,
        'scriptRevision', case when ${roomScriptRevision} > 0 then ${roomScriptRevision} else null end,
        'config', ${roomScriptConfig},
        'state', ${roomScriptState},
        'roomSurface', ${roomSurfaceData}
      )),
      r.created_by,
      coalesce(r.created_at, now())
    from rooms_legacy r
    join room_id_map room_map on room_map.old_room_id = r.id
    order by r.id
  `);

  logStep('Migrating message nodes...');
  await client.query(`
    insert into nodes (id, parent_id, type, component, client_script, server_script, data, created_by, created_at)
    select
      message_map.new_node_id,
      room_map.new_node_id,
      'message',
      null,
      ${messageScriptId},
      case
        when ${messageScriptMode} = 'client_server' and ${messageScriptId} is not null then ${messageScriptId}
        else null
      end,
      jsonb_strip_nulls(jsonb_build_object(
        'scriptMode', case when ${messageScriptId} is not null then ${messageScriptMode} else null end,
        'scriptRevision', case when ${messageScriptRevision} > 0 then ${messageScriptRevision} else null end,
        'config', ${messageScriptConfig},
        'state', ${messageScriptState}
      )),
      m.sender_id,
      coalesce(m.created_at, now())
    from messages_legacy m
    join room_id_map room_map on room_map.old_room_id = m.room_id
    join message_id_map message_map on message_map.old_message_id = m.id
    order by m.id
  `);

  const discussionKindExpr = messageColumns.discussionRoomId
    ? `case
         when exists (
           select 1
           from messages_legacy discussion_source
           where discussion_source.discussion_room_id = legacy_room.id
         ) then 'comment'
         else legacy_room.kind::text
       end`
    : `legacy_room.kind::text`;
  const roomVisibilityExpr = roomColumns.visibility
    ? `case
         when legacy_room.visibility::text = 'private' then 'private'
         when (${discussionKindExpr}) in ('direct', 'comment', 'game') then 'private'
         else 'public'
       end`
    : `case when (${discussionKindExpr}) in ('direct', 'comment', 'game') then 'private' else 'public' end`;
  const commentsEnabledExpr = roomColumns.commentsEnabled ? `coalesce(legacy_room.comments_enabled, true)` : `true`;
  const avatarPathExpr = roomColumns.avatarPath ? `nullif(btrim(legacy_room.avatar_path::text), '')` : `null::text`;
  const postOnlyByAdminExpr = roomColumns.postOnlyByAdmin ? `coalesce(legacy_room.post_only_by_admin, false)` : `false`;
  const pinnedJoin = roomColumns.pinnedMessageId
    ? `left join message_id_map pinned_map on pinned_map.old_message_id = legacy_room.pinned_message_id`
    : ``;
  const pinnedExpr = roomColumns.pinnedMessageId ? `pinned_map.new_node_id` : `null::integer`;

  logStep('Migrating rooms table...');
  await client.query(`
    insert into rooms (
      id,
      kind,
      title,
      visibility,
      comments_enabled,
      avatar_path,
      post_only_by_admin,
      pinned_node_id
    )
    select
      room_map.new_node_id,
      ${discussionKindExpr},
      legacy_room.title,
      ${roomVisibilityExpr},
      ${commentsEnabledExpr},
      ${avatarPathExpr},
      ${postOnlyByAdminExpr},
      ${pinnedExpr}
    from rooms_legacy legacy_room
    join room_id_map room_map on room_map.old_room_id = legacy_room.id
    ${pinnedJoin}
    order by legacy_room.id
  `);

  logStep('Migrating messages table...');
  await client.query(`
    insert into messages (id, sender_id, kind, raw_text, rendered_html, created_at)
    select
      message_map.new_node_id,
      legacy_message.sender_id,
      legacy_message.kind::text,
      coalesce(legacy_message.raw_text, ''),
      coalesce(legacy_message.rendered_html, ''),
      coalesce(legacy_message.created_at, now())
    from messages_legacy legacy_message
    join message_id_map message_map on message_map.old_message_id = legacy_message.id
    order by legacy_message.id
  `);

  if (messageColumns.discussionRoomId) {
    logStep('Linking comment rooms under message nodes...');
    await client.query(`
      update nodes target
      set parent_id = message_map.new_node_id
      from messages_legacy legacy_message
      join room_id_map discussion_room_map on discussion_room_map.old_room_id = legacy_message.discussion_room_id
      join message_id_map message_map on message_map.old_message_id = legacy_message.id
      where legacy_message.discussion_room_id is not null
        and target.id = discussion_room_map.new_node_id
    `);
  }

  logStep('Migrating room memberships...');
  await client.query(`
    insert into rooms_users (room_id, user_id, joined_at)
    select
      room_map.new_node_id,
      legacy_membership.user_id,
      coalesce(legacy_membership.joined_at, now())
    from rooms_users_legacy legacy_membership
    join room_id_map room_map on room_map.old_room_id = legacy_membership.room_id
    on conflict do nothing
  `);

  if (messageColumns.discussionRoomId) {
    logStep('Ensuring comment-room memberships...');
    await client.query(`
      insert into rooms_users (room_id, user_id, joined_at)
      select
        discussion_room_map.new_node_id,
        source_membership.user_id,
        coalesce(source_membership.joined_at, now())
      from messages_legacy source_message
      join room_id_map discussion_room_map on discussion_room_map.old_room_id = source_message.discussion_room_id
      join rooms_users_legacy source_membership on source_membership.room_id = source_message.room_id
      where source_message.discussion_room_id is not null
      on conflict do nothing
    `);
  }

  logStep('Migrating reactions...');
  await client.query(`
    insert into message_reactions (id, message_id, user_id, reaction, created_at)
    select
      legacy_reaction.id,
      message_map.new_node_id,
      legacy_reaction.user_id,
      legacy_reaction.reaction,
      coalesce(legacy_reaction.created_at, now())
    from message_reactions_legacy legacy_reaction
    join message_id_map message_map on message_map.old_message_id = legacy_reaction.message_id
    order by legacy_reaction.id
  `);

  if (await tableExists(client, 'game_sessions_legacy')) {
    logStep('Migrating game sessions...');
    await client.query(`
      insert into game_sessions (
        id,
        room_id,
        module_key,
        status,
        visibility,
        created_by,
        created_at,
        started_at,
        finished_at,
        settings_json,
        state_json
      )
      select
        legacy_session.id,
        room_map.new_node_id,
        legacy_session.module_key,
        legacy_session.status,
        legacy_session.visibility,
        legacy_session.created_by,
        coalesce(legacy_session.created_at, now()),
        legacy_session.started_at,
        legacy_session.finished_at,
        legacy_session.settings_json,
        legacy_session.state_json
      from game_sessions_legacy legacy_session
      join room_id_map room_map on room_map.old_room_id = legacy_session.room_id
      order by legacy_session.id
    `);
  }

  if (await tableExists(client, 'game_session_players_legacy')) {
    logStep('Migrating game session players...');
    await client.query(`
      insert into game_session_players (session_id, user_id, seat, kind, joined_at, is_ready)
      select
        legacy_player.session_id,
        legacy_player.user_id,
        legacy_player.seat,
        legacy_player.kind,
        coalesce(legacy_player.joined_at, now()),
        coalesce(legacy_player.is_ready, true)
      from game_session_players_legacy legacy_player
      order by legacy_player.session_id, legacy_player.user_id
    `);
  }

  logStep('Migrating active invite room grants...');
  await client.query(`
    insert into invites_rooms (invite_id, room_id)
    select
      invite.id,
      room_map.new_node_id
    from invites invite
    join rooms_legacy legacy_room on legacy_room.kind::text = 'group'
    join room_id_map room_map on room_map.old_room_id = legacy_room.id
    on conflict do nothing
  `);

  await resetSequence(client, 'nodes', 'id');
  await resetSequence(client, 'message_reactions', 'id');
  await resetSequence(client, 'game_sessions', 'id');
}

async function resetSequence(client: Client, tableName: string, columnName: string) {
  const result = await client.query(`select pg_get_serial_sequence($1, $2) as sequence_name`, [`public.${tableName}`, columnName]);
  const sequenceName = String(result.rows[0]?.sequence_name || '').trim();
  if (!sequenceName) return;
  await client.query(`
    select setval(
      $1::regclass,
      coalesce((select max(${quoteIdent(columnName)})::bigint from ${quoteIdent(tableName)}), 1),
      (select count(*) > 0 from ${quoteIdent(tableName)})
    )
  `, [sequenceName]);
}

async function verifyCounts(client: Client) {
  const checks = [
    {
      name: 'rooms',
      expected: await scalarInt(client, `select count(*) as value from rooms_legacy`),
      actual: await scalarInt(client, `select count(*) as value from rooms`),
    },
    {
      name: 'messages',
      expected: await scalarInt(client, `select count(*) as value from messages_legacy`),
      actual: await scalarInt(client, `select count(*) as value from messages`),
    },
    {
      name: 'message_reactions',
      expected: await scalarInt(client, `select count(*) as value from message_reactions_legacy`),
      actual: await scalarInt(client, `select count(*) as value from message_reactions`),
    },
  ];

  if (await tableExists(client, 'game_sessions_legacy')) {
    checks.push({
      name: 'game_sessions',
      expected: await scalarInt(client, `select count(*) as value from game_sessions_legacy`),
      actual: await scalarInt(client, `select count(*) as value from game_sessions`),
    });
  }

  if (await tableExists(client, 'game_session_players_legacy')) {
    checks.push({
      name: 'game_session_players',
      expected: await scalarInt(client, `select count(*) as value from game_session_players_legacy`),
      actual: await scalarInt(client, `select count(*) as value from game_session_players`),
    });
  }

  for (const check of checks) {
    if (check.expected !== check.actual) {
      throw new Error(`count_mismatch:${check.name}:${check.expected}:${check.actual}`);
    }
  }

  const missingMemberships = await scalarInt(client, `
    select count(*) as value
    from rooms_users_legacy legacy_membership
    join rooms_legacy legacy_room on legacy_room.id = legacy_membership.room_id
    join rooms migrated_room on migrated_room.id = legacy_room.id
    left join rooms_users migrated_membership
      on migrated_membership.room_id = migrated_room.id
     and migrated_membership.user_id = legacy_membership.user_id
    where migrated_membership.room_id is null
  `);
  if (missingMemberships !== 0) {
    throw new Error(`count_mismatch:rooms_users_missing_legacy_rows:${missingMemberships}`);
  }
}

async function verifyFinalShape(client: Client) {
  const requiredColumns: Array<{tableName: string; columnName: string}> = [
    {tableName: 'users', columnName: 'avatar_path'},
    {tableName: 'rooms', columnName: 'visibility'},
    {tableName: 'rooms', columnName: 'comments_enabled'},
    {tableName: 'rooms', columnName: 'avatar_path'},
    {tableName: 'rooms', columnName: 'post_only_by_admin'},
    {tableName: 'rooms', columnName: 'pinned_node_id'},
  ];

  for (const column of requiredColumns) {
    if (!await columnExists(client, column.tableName, column.columnName)) {
      throw new Error(`semantic_check_failed:missing_column:${column.tableName}.${column.columnName}`);
    }
  }

  const removedColumns: Array<{tableName: string; columnName: string}> = [
    {tableName: 'messages', columnName: 'room_id'},
    {tableName: 'messages', columnName: 'discussion_room_id'},
    {tableName: 'rooms', columnName: 'pinned_message_id'},
    {tableName: 'rooms', columnName: 'script_id'},
    {tableName: 'rooms', columnName: 'script_mode'},
    {tableName: 'rooms', columnName: 'script_config_json'},
    {tableName: 'rooms', columnName: 'script_revision'},
    {tableName: 'rooms', columnName: 'script_state_json'},
    {tableName: 'messages', columnName: 'script_id'},
    {tableName: 'messages', columnName: 'script_mode'},
    {tableName: 'messages', columnName: 'script_config_json'},
    {tableName: 'messages', columnName: 'script_revision'},
    {tableName: 'messages', columnName: 'script_state_json'},
    {tableName: 'rooms', columnName: 'app_enabled'},
    {tableName: 'rooms', columnName: 'app_type'},
    {tableName: 'rooms', columnName: 'app_config_json'},
    {tableName: 'invites', columnName: 'used_by'},
    {tableName: 'invites', columnName: 'used_at'},
  ];

  for (const column of removedColumns) {
    if (await columnExists(client, column.tableName, column.columnName)) {
      throw new Error(`semantic_check_failed:legacy_column_exists:${column.tableName}.${column.columnName}`);
    }
  }

  for (const tableName of ['nodes', 'invites_rooms', 'users_contacts']) {
    if (!await tableExists(client, tableName)) {
      throw new Error(`semantic_check_failed:missing_table:${tableName}`);
    }
  }
}

async function verifySemantics(client: Client) {
  const checks = [
    {
      name: 'rooms_have_room_nodes',
      actual: await scalarInt(client, `
        select count(*) as value
        from rooms r
        left join nodes n on n.id = r.id
        where n.id is null or n.type <> 'room'
      `),
    },
    {
      name: 'messages_have_message_nodes',
      actual: await scalarInt(client, `
        select count(*) as value
        from messages m
        left join nodes n on n.id = m.id
        where n.id is null or n.type <> 'message'
      `),
    },
    {
      name: 'message_nodes_have_room_parent',
      actual: await scalarInt(client, `
        select count(*) as value
        from messages m
        join nodes message_node on message_node.id = m.id
        left join nodes parent_node on parent_node.id = message_node.parent_id
        left join rooms parent_room on parent_room.id = parent_node.id
        where message_node.parent_id is null
          or parent_node.type <> 'room'
          or parent_room.id is null
      `),
    },
    {
      name: 'comment_rooms_have_message_parent',
      actual: await scalarInt(client, `
        select count(*) as value
        from rooms comment_room
        join nodes comment_node on comment_node.id = comment_room.id
        left join nodes parent_node on parent_node.id = comment_node.parent_id
        left join messages parent_message on parent_message.id = parent_node.id
        where comment_room.kind = 'comment'
          and (
            comment_node.parent_id is null
            or parent_node.type <> 'message'
            or parent_message.id is null
          )
      `),
    },
    {
      name: 'pinned_nodes_reference_message_nodes',
      actual: await scalarInt(client, `
        select count(*) as value
        from rooms r
        left join nodes n on n.id = r.pinned_node_id
        left join messages m on m.id = r.pinned_node_id
        where r.pinned_node_id is not null
          and (n.id is null or n.type <> 'message' or m.id is null)
      `),
    },
    {
      name: 'orphan_room_nodes',
      actual: await scalarInt(client, `
        select count(*) as value
        from nodes n
        left join rooms r on r.id = n.id
        where n.type = 'room' and r.id is null
      `),
    },
    {
      name: 'orphan_message_nodes',
      actual: await scalarInt(client, `
        select count(*) as value
        from nodes n
        left join messages m on m.id = n.id
        where n.type = 'message' and m.id is null
      `),
    },
    {
      name: 'memberships_reference_existing_rooms',
      actual: await scalarInt(client, `
        select count(*) as value
        from rooms_users ru
        left join rooms r on r.id = ru.room_id
        where r.id is null
      `),
    },
    {
      name: 'reactions_reference_existing_messages',
      actual: await scalarInt(client, `
        select count(*) as value
        from message_reactions mr
        left join messages m on m.id = mr.message_id
        where m.id is null
      `),
    },
    {
      name: 'game_sessions_reference_existing_rooms',
      actual: await scalarInt(client, `
        select count(*) as value
        from game_sessions gs
        left join rooms r on r.id = gs.room_id
        where r.id is null
      `),
    },
    {
      name: 'invite_room_grants_reference_existing_rooms',
      actual: await scalarInt(client, `
        select count(*) as value
        from invites_rooms ir
        left join rooms r on r.id = ir.room_id
        where r.id is null
      `),
    },
  ];

  for (const check of checks) {
    if (check.actual !== 0) {
      throw new Error(`semantic_check_failed:${check.name}:${check.actual}`);
    }
  }

  await verifyFinalShape(client);
}

async function markPrismaMigrationsApplied(client: Client) {
  const migrationsDir = join(backendDir(), 'prisma', 'migrations');
  if (!existsSync(migrationsDir)) {
    logStep('Prisma migrations dir not found, skipping _prisma_migrations marker.');
    return;
  }

  await client.query(`
    create table if not exists _prisma_migrations (
      id varchar(36) primary key,
      checksum varchar(64) not null,
      finished_at timestamptz,
      migration_name varchar(255) not null,
      logs text,
      rolled_back_at timestamptz,
      started_at timestamptz not null default now(),
      applied_steps_count integer not null default 0
    )
  `);

  const migrationNames = readdirSync(migrationsDir, {withFileTypes: true})
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  for (const migrationName of migrationNames) {
    const migrationPath = join(migrationsDir, migrationName, 'migration.sql');
    if (!existsSync(migrationPath)) continue;

    const exists = await client.query(
      `select 1 from _prisma_migrations where migration_name = $1 limit 1`,
      [migrationName],
    );
    if (exists.rowCount) continue;

    const sql = readFileSync(migrationPath, 'utf8');
    const checksum = createHash('sha256').update(sql).digest('hex');
    await client.query(
      `insert into _prisma_migrations (
         id,
         checksum,
         finished_at,
         migration_name,
         logs,
         rolled_back_at,
         started_at,
         applied_steps_count
       ) values ($1, $2, now(), $3, null, null, now(), 1)`,
      [randomUUID(), checksum, migrationName],
    );
  }
}

async function finalizeMigration(client: Client) {
  await client.query(`
    create table ${quoteIdent(META_TABLE)} (
      id integer generated by default as identity primary key,
      completed_at timestamptz(3) not null default now(),
      notes text not null
    )
  `);

  await client.query(
    `insert into ${quoteIdent(META_TABLE)} (notes) values ($1)`,
    ['legacy rooms/messages migrated to canonical nodes tree; legacy tables kept as *_legacy'],
  );

  await markPrismaMigrationsApplied(client);
}

async function dropLegacyTablesAndTypes(client: Client) {
  logStep('Dropping legacy tables/types...');

  const tables = [
    'graph_edges_legacy',
    'graph_nodes_legacy',
    'rooms_users_legacy',
    'message_reactions_legacy',
    'game_session_players_legacy',
    'game_sessions_legacy',
    'messages_legacy',
    'rooms_legacy',
  ];

  for (const tableName of tables) {
    await client.query(`drop table if exists ${quoteIdent(tableName)} cascade`);
  }

  const types = [
    'GraphEdgeType',
    'GraphTargetType',
    'GraphNodeKind',
    'RoomAppType',
    'ScriptExecutionMode',
    'MessageKind',
    'RoomKind',
  ];

  for (const typeName of types) {
    await client.query(`drop type if exists ${quoteIdent(typeName)} cascade`);
  }

  await client.query(
    `insert into ${quoteIdent(META_TABLE)} (notes) values ($1)`,
    ['legacy tables/types dropped after explicit MIGRATION_DROP_LEGACY_TABLES=1'],
  );
}

async function lockExistingTables(client: Client, tableNames: string[]) {
  const existingNames: string[] = [];
  for (const tableName of tableNames) {
    if (await tableExists(client, tableName)) existingNames.push(tableName);
  }
  if (!existingNames.length) return;

  await client.query(`lock table ${existingNames.map(quoteIdent).join(', ')} in access exclusive mode`);
}

async function run() {
  const client = new Client({
    connectionString: connectionString(),
  });

  await client.connect();

  try {
    const isMigrated = await alreadyMigrated(client);
    if (isMigrated) {
      if (process.env.MIGRATION_DROP_LEGACY_TABLES === '1') {
        await client.query('begin');
        await client.query(`set local lock_timeout = '10s'`);
        await client.query(`set local statement_timeout = '0'`);
        await dropLegacyTablesAndTypes(client);
        await client.query('commit');
        logStep('legacy cleanup completed successfully');
      } else {
        logStep('nodes migration already applied, nothing to do');
      }
      return;
    }

    await ensureLegacySchema(client);

    await client.query('begin');
    await client.query(`set local lock_timeout = '10s'`);
    await client.query(`set local statement_timeout = '0'`);
    await lockExistingTables(client, [
      'users',
      'invites',
      'rooms',
      'messages',
      'rooms_users',
      'message_reactions',
      'game_sessions',
      'game_session_players',
      'graph_edges',
      'graph_nodes',
    ]);

    await ensureUserAndInviteShape(client);

    logStep('Renaming legacy tables...');
    await renameLegacyTables(client);

    logStep('Creating new nodes schema...');
    await createNewSchema(client);

    await migrateData(client);
    await verifyCounts(client);
    await verifySemantics(client);
    await finalizeMigration(client);

    if (process.env.MIGRATION_DROP_LEGACY_TABLES === '1') {
      await dropLegacyTablesAndTypes(client);
    }

    await client.query('commit');
    logStep('nodes migration completed successfully');
  } catch (error) {
    try {
      await client.query('rollback');
    } catch {
      // ignore rollback failure
    }
    throw error;
  } finally {
    await client.end();
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
