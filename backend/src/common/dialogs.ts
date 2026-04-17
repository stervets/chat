import {db} from '../db.js';

export type DialogRow = {
  id: number;
  kind: string;
  member_a: number | null;
  member_b: number | null;
};

export async function getOrCreateGeneralDialog(): Promise<DialogRow> {
  let dialog = await db.dialog.findFirst({
    where: {kind: 'general'},
    select: {
      id: true,
      kind: true,
      memberAId: true,
      memberBId: true,
    },
  });

  if (!dialog) {
    try {
      dialog = await db.dialog.create({
        data: {kind: 'general'},
        select: {
          id: true,
          kind: true,
          memberAId: true,
          memberBId: true,
        },
      });
    } catch {
      dialog = await db.dialog.findFirst({
        where: {kind: 'general'},
        select: {
          id: true,
          kind: true,
          memberAId: true,
          memberBId: true,
        },
      });
    }
  }

  if (!dialog) {
    throw new Error('failed_to_create_general_dialog');
  }

  return {
    id: dialog.id,
    kind: dialog.kind,
    member_a: dialog.memberAId,
    member_b: dialog.memberBId,
  };
}

export async function getDialogById(dialogId: number): Promise<DialogRow | null> {
  const result = await db.dialog.findUnique({
    where: {id: dialogId},
    select: {
      id: true,
      kind: true,
      memberAId: true,
      memberBId: true,
    },
  });
  if (!result) return null;
  return {
    id: result.id,
    kind: result.kind,
    member_a: result.memberAId,
    member_b: result.memberBId,
  };
}

export function normalizePair(userId: number, otherId: number) {
  return userId < otherId
    ? {a: userId, b: otherId}
    : {a: otherId, b: userId};
}

export async function getOrCreatePrivateDialog(userId: number, otherId: number): Promise<DialogRow> {
  const {a, b} = normalizePair(userId, otherId);
  let dialog = await db.dialog.findFirst({
    where: {
      kind: 'private',
      memberAId: a,
      memberBId: b,
    },
    select: {
      id: true,
      kind: true,
      memberAId: true,
      memberBId: true,
    },
  });

  if (!dialog) {
    try {
      dialog = await db.dialog.create({
        data: {
          kind: 'private',
          memberAId: a,
          memberBId: b,
        },
        select: {
          id: true,
          kind: true,
          memberAId: true,
          memberBId: true,
        },
      });
    } catch {
      dialog = await db.dialog.findFirst({
        where: {
          kind: 'private',
          memberAId: a,
          memberBId: b,
        },
        select: {
          id: true,
          kind: true,
          memberAId: true,
          memberBId: true,
        },
      });
    }
  }

  if (!dialog) {
    throw new Error('failed_to_create_private_dialog');
  }

  return {
    id: dialog.id,
    kind: dialog.kind,
    member_a: dialog.memberAId,
    member_b: dialog.memberBId,
  };
}

export function userCanAccessDialog(userId: number, dialog: DialogRow) {
  if (dialog.kind === 'general') return true;
  if (dialog.kind === 'private') {
    return dialog.member_a === userId || dialog.member_b === userId;
  }
  return false;
}
