import {createInterface} from 'node:readline/promises';
import {stdin as input, stdout as output} from 'node:process';
import {randomBytes} from 'node:crypto';
import {hashPassword} from '../common/auth.js';
import {DEFAULT_NICKNAME_COLOR} from '../common/const.js';
import {config} from '../config.js';
import {db, closeDb} from '../db.js';

type UserRow = {
  id: number;
  nickname: string;
  name: string;
  nicknameColor: string | null;
  createdAt: string;
  updatedAt: string;
};

type InviteRow = {
  id: number;
  code: string;
  createdById: number | null;
  createdByNickname: string | null;
  createdAt: string;
  usedById: number | null;
  usedByNickname: string | null;
  usedAt: string | null;
  expiresAt: string | null;
};

const rl = createInterface({input, output});

const nowIso = () => new Date().toISOString();
const clearScreen = () => output.write('\x1Bc');
const normalize = (value: string) => value.trim();
const normalizeNickname = (value: string) => normalize(value).toLowerCase();
const printable = (value: string | number | null) => (value === null ? '-' : String(value));
const isYes = (value: string) => ['y', 'yes', 'д', 'да'].includes(value.toLowerCase());
const inviteLink = (code: string) => `${config.inviteBaseUrl}/invite/${encodeURIComponent(code)}`;

async function ask(question: string) {
  return normalize(await rl.question(question));
}

async function pause() {
  await rl.question('\nНажми Enter, чтобы продолжить...');
}

function renderTitle(title: string) {
  clearScreen();
  output.write(`${title}\n`);
  output.write('='.repeat(title.length));
  output.write('\n\n');
}

function getUsers() {
  return db.prepare(
    `select
       id,
       nickname,
       coalesce(name, nickname) as name,
       nickname_color as "nicknameColor",
       created_at as "createdAt",
       updated_at as "updatedAt"
     from users
     order by id asc`
  ).all() as UserRow[];
}

function getInvites() {
  return db.prepare(
    `select
       i.id,
       i.code,
       i.created_by as "createdById",
       c.nickname as "createdByNickname",
       i.created_at as "createdAt",
       i.used_by as "usedById",
       u.nickname as "usedByNickname",
       i.used_at as "usedAt",
       i.expires_at as "expiresAt"
     from invites i
     left join users c on c.id = i.created_by
     left join users u on u.id = i.used_by
     order by i.created_at desc`
  ).all() as InviteRow[];
}

function renderUsers(rows: UserRow[]) {
  if (rows.length === 0) {
    output.write('Пользователей пока нет.\n');
    return;
  }

  for (const row of rows) {
    output.write(`#${row.id}  ${row.name} (@${row.nickname})\n`);
    output.write(`    color: ${printable(row.nicknameColor)}\n`);
    output.write(`    created: ${row.createdAt}\n`);
    output.write(`    updated: ${row.updatedAt}\n`);
  }
}

function renderInvites(rows: InviteRow[]) {
  if (rows.length === 0) {
    output.write('Инвайтов пока нет.\n');
    return;
  }

  for (const row of rows) {
    const status = row.usedAt ? 'used' : 'new';
    output.write(`#${row.id}  ${row.code}  [${status}]\n`);
    output.write(`    createdBy: ${printable(row.createdById)} (${printable(row.createdByNickname)})\n`);
    output.write(`    createdAt: ${row.createdAt}\n`);
    output.write(`    usedBy: ${printable(row.usedById)} (${printable(row.usedByNickname)})\n`);
    output.write(`    usedAt: ${printable(row.usedAt)}\n`);
    output.write(`    expiresAt: ${printable(row.expiresAt)}\n`);
  }
}

function parsePositiveInt(raw: string) {
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value <= 0) return null;
  return value;
}

function userExists(id: number) {
  const row = db.prepare('select id from users where id = ?').get(id) as {id: number} | undefined;
  return Boolean(row?.id);
}

function inviteExists(id: number) {
  const row = db.prepare('select id from invites where id = ?').get(id) as {id: number} | undefined;
  return Boolean(row?.id);
}

async function createUniqueInviteCode() {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = randomBytes(8).toString('hex');
    try {
      db.prepare('insert into invites (code) values (?)').run(code);
      return code;
    } catch (err: any) {
      const sqliteCode = err?.code;
      if (sqliteCode === 'SQLITE_CONSTRAINT' || sqliteCode === 'SQLITE_CONSTRAINT_UNIQUE') {
        continue;
      }
      throw err;
    }
  }
  throw new Error('failed_to_generate_invite_code');
}

async function listUsersAction() {
  renderTitle('Пользователи');
  renderUsers(getUsers());
  await pause();
}

async function addUserAction() {
  renderTitle('Добавление пользователя');
  const nickname = normalizeNickname(await ask('nickname: '));
  const name = await ask('name (Enter = nickname): ');
  const password = await ask('password: ');

  if (!nickname || !password) {
    output.write('\nnickname и password обязательны.\n');
    await pause();
    return;
  }

  try {
    const passwordHash = await hashPassword(password);
    const insert = db.prepare(
      'insert into users (nickname, name, nickname_color, password_hash) values (?, ?, ?, ?)'
    ).run(nickname, name || nickname, DEFAULT_NICKNAME_COLOR, passwordHash);
    output.write(`\nПользователь создан: id=${Number(insert.lastInsertRowid)}\n`);
  } catch (err: any) {
    output.write(`\nНе удалось создать пользователя: ${String(err?.message || err)}\n`);
  }

  await pause();
}

async function editUserAction() {
  renderTitle('Редактирование пользователя');
  const users = getUsers();
  renderUsers(users);

  const idRaw = await ask('\nid пользователя: ');
  const id = parsePositiveInt(idRaw);
  if (!id) {
    output.write('\nНекорректный id.\n');
    await pause();
    return;
  }

  const user = users.find((item) => item.id === id);
  if (!user) {
    output.write('\nПользователь не найден.\n');
    await pause();
    return;
  }

  const nextNicknameRaw = await ask(`новый nickname [${user.nickname}] (Enter = без изменений): `);
  const nextNickname = nextNicknameRaw ? normalizeNickname(nextNicknameRaw) : '';
  const nextName = await ask(`новое имя [${user.name}] (Enter = без изменений): `);
  const nextNicknameColor = await ask(
    `цвет никнейма [${printable(user.nicknameColor)}] (Enter = без изменений, "-" = очистить): `
  );
  const nextPassword = await ask('новый password (Enter = без изменений): ');
  const updateTime = nowIso();

  try {
    const fields: string[] = [];
    const values: Array<string | number | null> = [];

    if (nextNickname) {
      fields.push('nickname = ?');
      values.push(nextNickname);
    }

    if (nextName) {
      fields.push('name = ?');
      values.push(nextName);
    }

    if (nextNicknameColor) {
      fields.push('nickname_color = ?');
      values.push(nextNicknameColor === '-' ? null : nextNicknameColor);
    }

    if (nextPassword) {
      const passwordHash = await hashPassword(nextPassword);
      fields.push('password_hash = ?');
      values.push(passwordHash);
    }

    if (!fields.length) {
      output.write('\nИзменений нет.\n');
      await pause();
      return;
    }

    fields.push('updated_at = ?');
    values.push(updateTime);
    values.push(id);

    db.prepare(`update users set ${fields.join(', ')} where id = ?`).run(...values);
    output.write('\nПользователь обновлён.\n');
  } catch (err: any) {
    output.write(`\nНе удалось обновить пользователя: ${String(err?.message || err)}\n`);
  }

  await pause();
}

async function deleteUserAction() {
  renderTitle('Удаление пользователя');
  renderUsers(getUsers());

  const idRaw = await ask('\nid пользователя: ');
  const id = parsePositiveInt(idRaw);
  if (!id) {
    output.write('\nНекорректный id.\n');
    await pause();
    return;
  }

  if (!userExists(id)) {
    output.write('\nПользователь не найден.\n');
    await pause();
    return;
  }

  const confirm = await ask('Подтверди удаление (YES): ');
  if (confirm !== 'YES') {
    output.write('\nУдаление отменено.\n');
    await pause();
    return;
  }

  const result = db.prepare('delete from users where id = ?').run(id);
  output.write(`\nУдалено пользователей: ${result.changes}\n`);
  await pause();
}

async function listInvitesAction() {
  renderTitle('Инвайты');
  renderInvites(getInvites());
  await pause();
}

async function addInviteAction() {
  renderTitle('Добавление инвайта');
  const typedCode = await ask('code (Enter = сгенерировать): ');
  const code = typedCode || randomBytes(8).toString('hex');
  const createdByRaw = await ask('created_by id (Enter = пусто): ');
  const expiresAtRaw = await ask('expires_at ISO (Enter = пусто): ');

  let createdBy: number | null = null;
  if (createdByRaw) {
    const parsed = parsePositiveInt(createdByRaw);
    if (!parsed) {
      output.write('\nНекорректный created_by.\n');
      await pause();
      return;
    }
    if (!userExists(parsed)) {
      output.write('\ncreated_by не найден в users.\n');
      await pause();
      return;
    }
    createdBy = parsed;
  }

  const expiresAt = expiresAtRaw || null;

  try {
    const insert = db.prepare(
      'insert into invites (code, created_by, expires_at) values (?, ?, ?)'
    ).run(code, createdBy, expiresAt);
    output.write(`\nИнвайт создан: id=${Number(insert.lastInsertRowid)}\n`);
    output.write(`Ссылка: ${inviteLink(code)}\n`);
  } catch (err: any) {
    output.write(`\nНе удалось создать инвайт: ${String(err?.message || err)}\n`);
  }

  await pause();
}

async function editInviteAction() {
  renderTitle('Редактирование инвайта');
  const invites = getInvites();
  renderInvites(invites);

  const idRaw = await ask('\nid инвайта: ');
  const id = parsePositiveInt(idRaw);
  if (!id) {
    output.write('\nНекорректный id.\n');
    await pause();
    return;
  }

  const invite = invites.find((item) => item.id === id);
  if (!invite) {
    output.write('\nИнвайт не найден.\n');
    await pause();
    return;
  }

  const nextCode = await ask(`новый code [${invite.code}] (Enter = без изменений): `);
  const nextCreatedByRaw = await ask(
    `новый created_by [${printable(invite.createdById)}] (Enter = без изменений, "-" = очистить): `
  );
  const nextExpiresRaw = await ask(
    `новый expires_at [${printable(invite.expiresAt)}] (Enter = без изменений, "-" = очистить): `
  );
  const resetUsedRaw = await ask('сбросить used_by/used_at? [y/N]: ');

  const fields: string[] = [];
  const values: (string | number | null)[] = [];

  if (nextCode) {
    fields.push('code = ?');
    values.push(nextCode);
  }

  if (nextCreatedByRaw) {
    if (nextCreatedByRaw === '-') {
      fields.push('created_by = ?');
      values.push(null);
    } else {
      const parsed = parsePositiveInt(nextCreatedByRaw);
      if (!parsed || !userExists(parsed)) {
        output.write('\nНекорректный created_by.\n');
        await pause();
        return;
      }
      fields.push('created_by = ?');
      values.push(parsed);
    }
  }

  if (nextExpiresRaw) {
    fields.push('expires_at = ?');
    values.push(nextExpiresRaw === '-' ? null : nextExpiresRaw);
  }

  if (isYes(resetUsedRaw)) {
    fields.push('used_by = null');
    fields.push('used_at = null');
  }

  if (fields.length === 0) {
    output.write('\nИзменений нет.\n');
    await pause();
    return;
  }

  try {
    values.push(id);
    db.prepare(`update invites set ${fields.join(', ')} where id = ?`).run(...values);
    output.write('\nИнвайт обновлён.\n');
  } catch (err: any) {
    output.write(`\nНе удалось обновить инвайт: ${String(err?.message || err)}\n`);
  }

  await pause();
}

async function deleteInviteAction() {
  renderTitle('Удаление инвайта');
  renderInvites(getInvites());

  const idRaw = await ask('\nid инвайта: ');
  const id = parsePositiveInt(idRaw);
  if (!id) {
    output.write('\nНекорректный id.\n');
    await pause();
    return;
  }

  if (!inviteExists(id)) {
    output.write('\nИнвайт не найден.\n');
    await pause();
    return;
  }

  const confirm = await ask('Подтверди удаление (YES): ');
  if (confirm !== 'YES') {
    output.write('\nУдаление отменено.\n');
    await pause();
    return;
  }

  const result = db.prepare('delete from invites where id = ?').run(id);
  output.write(`\nУдалено инвайтов: ${result.changes}\n`);
  await pause();
}

async function usersMenu() {
  while (true) {
    renderTitle('Users');
    output.write('1. Просмотр пользователей\n');
    output.write('2. Добавить пользователя\n');
    output.write('3. Редактировать пользователя\n');
    output.write('4. Удалить пользователя\n');
    output.write('0. Назад\n\n');

    const choice = await ask('Выбор: ');
    if (choice === '0') return;
    if (choice === '1') await listUsersAction();
    if (choice === '2') await addUserAction();
    if (choice === '3') await editUserAction();
    if (choice === '4') await deleteUserAction();
  }
}

async function invitesMenu() {
  while (true) {
    renderTitle('Invites');
    output.write('1. Просмотр инвайтов\n');
    output.write('2. Добавить инвайт\n');
    output.write('3. Редактировать инвайт\n');
    output.write('4. Удалить инвайт\n');
    output.write('0. Назад\n\n');

    const choice = await ask('Выбор: ');
    if (choice === '0') return;
    if (choice === '1') await listInvitesAction();
    if (choice === '2') await addInviteAction();
    if (choice === '3') await editInviteAction();
    if (choice === '4') await deleteInviteAction();
  }
}

async function run() {
  while (true) {
    renderTitle('Admin TUI');
    output.write('1. Users\n');
    output.write('2. Invites\n');
    output.write('3. Сгенерировать invite-ссылку\n');
    output.write('0. Выход\n\n');

    const choice = await ask('Выбор: ');
    if (choice === '0') return;
    if (choice === '1') await usersMenu();
    if (choice === '2') await invitesMenu();
    if (choice === '3') {
      try {
        const code = await createUniqueInviteCode();
        output.write(`\nСсылка: ${inviteLink(code)}\n`);
      } catch (err: any) {
        output.write(`\nОшибка генерации инвайта: ${String(err?.message || err)}\n`);
      }
      await pause();
    }
  }
}

run()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => {
    rl.close();
    closeDb();
  });
