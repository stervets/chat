import {pool} from '../db.js';

export type DialogRow = {
  id: number;
  kind: string;
  member_a: number | null;
  member_b: number | null;
};

export async function getOrCreateGeneralDialog(): Promise<DialogRow> {
  const existing = await pool.query(
    "select id, kind, member_a, member_b from dialogs where kind = 'general' limit 1"
  );

  if (existing.rowCount) {
    return existing.rows[0];
  }

  try {
    const created = await pool.query(
      "insert into dialogs (kind) values ('general') returning id, kind, member_a, member_b"
    );
    return created.rows[0];
  } catch (err) {
    const retry = await pool.query(
      "select id, kind, member_a, member_b from dialogs where kind = 'general' limit 1"
    );
    if (retry.rowCount) {
      return retry.rows[0];
    }
    throw err;
  }
}

export async function getDialogById(dialogId: number): Promise<DialogRow | null> {
  const result = await pool.query(
    'select id, kind, member_a, member_b from dialogs where id = $1',
    [dialogId]
  );
  return result.rowCount ? result.rows[0] : null;
}

export function normalizePair(userId: number, otherId: number) {
  return userId < otherId
    ? {a: userId, b: otherId}
    : {a: otherId, b: userId};
}

export async function getOrCreatePrivateDialog(userId: number, otherId: number): Promise<DialogRow> {
  const {a, b} = normalizePair(userId, otherId);
  const existing = await pool.query(
    "select id, kind, member_a, member_b from dialogs where kind = 'private' and member_a = $1 and member_b = $2",
    [a, b]
  );

  if (existing.rowCount) {
    return existing.rows[0];
  }

  try {
    const created = await pool.query(
      "insert into dialogs (kind, member_a, member_b) values ('private', $1, $2) returning id, kind, member_a, member_b",
      [a, b]
    );
    return created.rows[0];
  } catch (err: any) {
    if (err && err.code === '23505') {
      const retry = await pool.query(
        "select id, kind, member_a, member_b from dialogs where kind = 'private' and member_a = $1 and member_b = $2",
        [a, b]
      );
      if (retry.rowCount) {
        return retry.rows[0];
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
