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

async function getUsers() {
  const rows = await db.user.findMany({
    orderBy: {id: 'asc'},
    select: {
      id: true,
      nickname: true,
      name: true,
      nicknameColor: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  return rows.map((row) => ({
    id: row.id,
    nickname: row.nickname,
    name: row.name || row.nickname,
    nicknameColor: row.nicknameColor,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  })) as UserRow[];
}

async function getInvites() {
  const rows = await db.invite.findMany({
    orderBy: {createdAt: 'desc'},
    include: {
      createdBy: {
        select: {
          id: true,
          nickname: true,
        },
      },
      usedBy: {
        select: {
          id: true,
          nickname: true,
        },
      },
    },
  });

  return rows.map((row) => ({
    id: row.id,
    code: row.code,
    createdById: row.createdBy?.id || null,
    createdByNickname: row.createdBy?.nickname || null,
    createdAt: row.createdAt.toISOString(),
    usedById: row.usedBy?.id || null,
    usedByNickname: row.usedBy?.nickname || null,
    usedAt: row.usedAt ? row.usedAt.toISOString() : null,
    expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
  })) as InviteRow[];
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

async function userExists(id: number) {
  const row = await db.user.findUnique({
    where: {id},
    select: {id: true},
  });
  return Boolean(row?.id);
}

async function inviteExists(id: number) {
  const row = await db.invite.findUnique({
    where: {id},
    select: {id: true},
  });
  return Boolean(row?.id);
}

async function createUniqueInviteCode() {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = randomBytes(8).toString('hex');
    try {
      await db.invite.create({
        data: {code},
        select: {id: true},
      });
      return code;
    } catch (err: any) {
      if (err?.code === 'P2002') {
        continue;
      }
      throw err;
    }
  }
  throw new Error('failed_to_generate_invite_code');
}

async function listUsersAction() {
  renderTitle('Пользователи');
  renderUsers(await getUsers());
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
    const created = await db.user.create({
      data: {
        nickname,
        nicknameNormalized: nickname,
        name: name || nickname,
        nicknameColor: DEFAULT_NICKNAME_COLOR,
        passwordHash,
      },
      select: {id: true},
    });
    output.write(`\nПользователь создан: id=${created.id}\n`);
  } catch (err: any) {
    output.write(`\nНе удалось создать пользователя: ${String(err?.message || err)}\n`);
  }

  await pause();
}

async function editUserAction() {
  renderTitle('Редактирование пользователя');
  const users = await getUsers();
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
    `цвет никнейма [${printable(user.nicknameColor)}] (Enter = без изменений, "-" = очистить): `,
  );
  const nextPassword = await ask('новый password (Enter = без изменений): ');

  try {
    const data: Record<string, unknown> = {};

    if (nextNickname) {
      data.nickname = nextNickname;
      data.nicknameNormalized = nextNickname;
    }

    if (nextName) {
      data.name = nextName;
    }

    if (nextNicknameColor) {
      data.nicknameColor = nextNicknameColor === '-' ? null : nextNicknameColor;
    }

    if (nextPassword) {
      const passwordHash = await hashPassword(nextPassword);
      data.passwordHash = passwordHash;
    }

    if (Object.keys(data).length === 0) {
      output.write('\nИзменений нет.\n');
      await pause();
      return;
    }

    await db.user.update({
      where: {id},
      data,
      select: {id: true},
    });
    output.write('\nПользователь обновлён.\n');
  } catch (err: any) {
    output.write(`\nНе удалось обновить пользователя: ${String(err?.message || err)}\n`);
  }

  await pause();
}

async function deleteUserAction() {
  renderTitle('Удаление пользователя');
  renderUsers(await getUsers());

  const idRaw = await ask('\nid пользователя: ');
  const id = parsePositiveInt(idRaw);
  if (!id) {
    output.write('\nНекорректный id.\n');
    await pause();
    return;
  }

  if (!await userExists(id)) {
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

  const result = await db.user.deleteMany({where: {id}});
  output.write(`\nУдалено пользователей: ${result.count}\n`);
  await pause();
}

async function listInvitesAction() {
  renderTitle('Инвайты');
  renderInvites(await getInvites());
  await pause();
}

async function addInviteAction() {
  renderTitle('Добавление инвайта');
  const typedCode = await ask('code (Enter = сгенерировать): ');
  const code = typedCode || randomBytes(8).toString('hex');
  const createdByRaw = await ask('created_by id (Enter = пусто): ');
  const expiresAtRaw = await ask('expires_at ISO (Enter = пусто): ');

  let createdById: number | null = null;
  if (createdByRaw) {
    const parsed = parsePositiveInt(createdByRaw);
    if (!parsed) {
      output.write('\nНекорректный created_by.\n');
      await pause();
      return;
    }
    if (!await userExists(parsed)) {
      output.write('\ncreated_by не найден в users.\n');
      await pause();
      return;
    }
    createdById = parsed;
  }

  let expiresAt: Date | null = null;
  if (expiresAtRaw) {
    const parsed = new Date(expiresAtRaw);
    if (Number.isNaN(parsed.getTime())) {
      output.write('\nНекорректный expires_at.\n');
      await pause();
      return;
    }
    expiresAt = parsed;
  }

  try {
    const created = await db.invite.create({
      data: {
        code,
        createdById,
        expiresAt,
      },
      select: {id: true},
    });
    output.write(`\nИнвайт создан: id=${created.id}\n`);
    output.write(`Ссылка: ${inviteLink(code)}\n`);
  } catch (err: any) {
    output.write(`\nНе удалось создать инвайт: ${String(err?.message || err)}\n`);
  }

  await pause();
}

async function editInviteAction() {
  renderTitle('Редактирование инвайта');
  const invites = await getInvites();
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
    `новый created_by [${printable(invite.createdById)}] (Enter = без изменений, "-" = очистить): `,
  );
  const nextExpiresRaw = await ask(
    `новый expires_at [${printable(invite.expiresAt)}] (Enter = без изменений, "-" = очистить): `,
  );
  const resetUsedRaw = await ask('сбросить used_by/used_at? [y/N]: ');

  const data: Record<string, unknown> = {};

  if (nextCode) {
    data.code = nextCode;
  }

  if (nextCreatedByRaw) {
    if (nextCreatedByRaw === '-') {
      data.createdById = null;
    } else {
      const parsed = parsePositiveInt(nextCreatedByRaw);
      if (!parsed || !await userExists(parsed)) {
        output.write('\nНекорректный created_by.\n');
        await pause();
        return;
      }
      data.createdById = parsed;
    }
  }

  if (nextExpiresRaw) {
    if (nextExpiresRaw === '-') {
      data.expiresAt = null;
    } else {
      const parsed = new Date(nextExpiresRaw);
      if (Number.isNaN(parsed.getTime())) {
        output.write('\nНекорректный expires_at.\n');
        await pause();
        return;
      }
      data.expiresAt = parsed;
    }
  }

  if (isYes(resetUsedRaw)) {
    data.usedById = null;
    data.usedAt = null;
  }

  if (Object.keys(data).length === 0) {
    output.write('\nИзменений нет.\n');
    await pause();
    return;
  }

  try {
    await db.invite.update({
      where: {id},
      data,
      select: {id: true},
    });
    output.write('\nИнвайт обновлён.\n');
  } catch (err: any) {
    output.write(`\nНе удалось обновить инвайт: ${String(err?.message || err)}\n`);
  }

  await pause();
}

async function deleteInviteAction() {
  renderTitle('Удаление инвайта');
  renderInvites(await getInvites());

  const idRaw = await ask('\nid инвайта: ');
  const id = parsePositiveInt(idRaw);
  if (!id) {
    output.write('\nНекорректный id.\n');
    await pause();
    return;
  }

  if (!await inviteExists(id)) {
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

  const result = await db.invite.deleteMany({where: {id}});
  output.write(`\nУдалено инвайтов: ${result.count}\n`);
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
    void closeDb();
  });
