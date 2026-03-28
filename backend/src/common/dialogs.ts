import {db} from '../db.js';

export type DialogRow = {
  id: number;
  kind: string;
  member_a: number | null;
  member_b: number | null;
};

export async function getOrCreateGeneralDialog(): Promise<DialogRow> {
  const existing = db.prepare(
    "select id, kind, member_a, member_b from dialogs where kind = 'general' limit 1"
  ).get();

  if (existing) {
    return existing as DialogRow;
  }

  try {
    const insert = db.prepare(
      "insert into dialogs (kind) values ('general')"
    ).run();
    const created = db.prepare(
      'select id, kind, member_a, member_b from dialogs where id = ?'
    ).get(Number(insert.lastInsertRowid));
    if (created) {
      return created as DialogRow;
    }
    throw new Error('failed_to_create_general_dialog');
  } catch (err) {
    const retry = db.prepare(
      "select id, kind, member_a, member_b from dialogs where kind = 'general' limit 1"
    ).get();
    if (retry) {
      return retry as DialogRow;
    }
    throw err;
  }
}

export async function getDialogById(dialogId: number): Promise<DialogRow | null> {
  const result = db.prepare(
    'select id, kind, member_a, member_b from dialogs where id = ?'
  ).get(dialogId);
  return result ? (result as DialogRow) : null;
}

export function normalizePair(userId: number, otherId: number) {
  return userId < otherId
    ? {a: userId, b: otherId}
    : {a: otherId, b: userId};
}

export async function getOrCreatePrivateDialog(userId: number, otherId: number): Promise<DialogRow> {
  const {a, b} = normalizePair(userId, otherId);
  const existing = db.prepare(
    "select id, kind, member_a, member_b from dialogs where kind = 'private' and member_a = ? and member_b = ?"
  ).get(a, b);

  if (existing) {
    return existing as DialogRow;
  }

  try {
    const insert = db.prepare(
      "insert into dialogs (kind, member_a, member_b) values ('private', ?, ?)"
    ).run(a, b);
    const created = db.prepare(
      'select id, kind, member_a, member_b from dialogs where id = ?'
    ).get(Number(insert.lastInsertRowid));
    if (created) {
      return created as DialogRow;
    }
    throw new Error('failed_to_create_private_dialog');
  } catch (err: any) {
    const code = err?.code;
    if (code === 'SQLITE_CONSTRAINT' || code === 'SQLITE_CONSTRAINT_UNIQUE') {
      const retry = db.prepare(
        "select id, kind, member_a, member_b from dialogs where kind = 'private' and member_a = ? and member_b = ?"
      ).get(a, b);
      if (retry) {
        return retry as DialogRow;
      }
    }
    throw err;
  }
}

export function userCanAccessDialog(userId: number, dialog: DialogRow) {
  if (dialog.kind === 'general') return true;
  if (dialog.kind === 'private') {
    return dialog.member_a === userId || dialog.member_b === userId;
  }
  return false;
}
