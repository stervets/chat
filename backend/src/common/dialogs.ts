import {db} from '../db.js';

export type DialogRow = {
  id: number;
  kind: string;
  member_a: number | null;
  member_b: number | null;
};

export async function getOrCreateGeneralDialog(): Promise<DialogRow> {
  db.prepare(
    "insert or ignore into dialogs (kind) values ('general')"
  ).run();

  const dialog = db.prepare(
    "select id, kind, member_a, member_b from dialogs where kind = 'general' limit 1"
  ).get();

  if (!dialog) {
    throw new Error('failed_to_create_general_dialog');
  }

  return dialog as DialogRow;
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
  db.prepare(
    "insert or ignore into dialogs (kind, member_a, member_b) values ('private', ?, ?)"
  ).run(a, b);

  const dialog = db.prepare(
    "select id, kind, member_a, member_b from dialogs where kind = 'private' and member_a = ? and member_b = ?"
  ).get(a, b);

  if (!dialog) {
    throw new Error('failed_to_create_private_dialog');
  }

  return dialog as DialogRow;
}

export function userCanAccessDialog(userId: number, dialog: DialogRow) {
  if (dialog.kind === 'general') return true;
  if (dialog.kind === 'private') {
    return dialog.member_a === userId || dialog.member_b === userId;
  }
  return false;
}
