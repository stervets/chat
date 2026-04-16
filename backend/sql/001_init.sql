-- Minimal schema for MARX (SQLite)

create table if not exists users (
  id integer primary key autoincrement,
  nickname text not null unique,
  name text not null,
  nickname_color text default '#61afef',
  password_hash text not null,
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
create unique index if not exists users_nickname_ci_unique on users(lower(nickname));

create table if not exists invites (
  id integer primary key autoincrement,
  code text not null unique,
  created_by integer references users(id) on delete set null,
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  used_by integer references users(id) on delete set null,
  used_at text,
  expires_at text
);

create table if not exists dialogs (
  id integer primary key autoincrement,
  kind text not null,
  member_a integer references users(id) on delete set null,
  member_b integer references users(id) on delete set null,
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

create unique index if not exists dialogs_general_unique on dialogs(kind) where kind = 'general';
create unique index if not exists dialogs_private_unique on dialogs(kind, member_a, member_b) where kind = 'private';
create index if not exists dialogs_private_lookup_idx on dialogs(member_a, member_b) where kind = 'private';

create table if not exists messages (
  id integer primary key autoincrement,
  dialog_id integer references dialogs(id) on delete cascade,
  sender_id integer references users(id) on delete set null,
  body text not null,
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

create index if not exists messages_dialog_created_idx on messages(dialog_id, created_at desc);

create table if not exists message_reactions (
  id integer primary key autoincrement,
  message_id integer not null references messages(id) on delete cascade,
  user_id integer not null references users(id) on delete cascade,
  reaction text not null,
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

create unique index if not exists message_reactions_unique on message_reactions(message_id, user_id);
create index if not exists message_reactions_message_idx on message_reactions(message_id, reaction);

create table if not exists sessions (
  id text primary key,
  user_id integer references users(id) on delete cascade,
  token text not null unique,
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  expires_at text not null,
  ip text,
  user_agent text
);
