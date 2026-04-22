import {db} from '../db.js';
import {getLatestScriptDefinition} from '../scriptable/registry.js';

export type RoomKind = 'group' | 'direct' | 'game';

export type RoomRow = {
  id: number;
  kind: RoomKind;
  title: string | null;
  created_by: number | null;
  member_user_ids: number[];
};

type RoomWithUsers = {
  id: number;
  kind: RoomKind;
  title: string | null;
  createdById: number | null;
  roomUsers: Array<{userId: number}>;
};

function mapRoom(row: RoomWithUsers): RoomRow {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title || null,
    created_by: row.createdById,
    member_user_ids: row.roomUsers.map((item) => item.userId),
  };
}

async function ensureRoomMembership(roomId: number, userId: number) {
  await db.roomUser.upsert({
    where: {
      roomId_userId: {
        roomId,
        userId,
      },
    },
    update: {},
    create: {
      roomId,
      userId,
    },
  });
}

export async function ensureUserInGroupRooms(userId: number) {
  const groupRooms = await db.room.findMany({
    where: {kind: 'group'},
    select: {id: true},
  });

  if (!groupRooms.length) return;

  await db.roomUser.createMany({
    data: groupRooms.map((room) => ({
      roomId: room.id,
      userId,
    })),
    skipDuplicates: true,
  });
}

export async function getOrCreateGroupRoom(): Promise<RoomRow> {
  let room = await db.room.findFirst({
    where: {kind: 'group'},
    orderBy: {id: 'asc'},
    select: {
      id: true,
      kind: true,
      title: true,
      createdById: true,
      roomUsers: {
        select: {userId: true},
      },
    },
  });

  if (!room) {
    const roomScriptDefinition = getLatestScriptDefinition('room', 'demo:room_meter');
    const roomScriptConfig = roomScriptDefinition?.makeInitialConfig
      ? roomScriptDefinition.makeInitialConfig({})
      : {};
    const roomScriptState = roomScriptDefinition?.makeInitialState
      ? roomScriptDefinition.makeInitialState({config: roomScriptConfig})
      : {};

    try {
      room = await db.room.create({
        data: {
          kind: 'group',
          title: 'Общий чат',
          ...(roomScriptDefinition
            ? {
              scriptId: roomScriptDefinition.scriptId,
              scriptRevision: roomScriptDefinition.revision,
              scriptMode: roomScriptDefinition.mode,
              scriptConfigJson: roomScriptConfig,
              scriptStateJson: roomScriptState,
            }
            : {}),
        },
        select: {
          id: true,
          kind: true,
          title: true,
          createdById: true,
          roomUsers: {
            select: {userId: true},
          },
        },
      });
    } catch {
      room = await db.room.findFirst({
        where: {kind: 'group'},
        orderBy: {id: 'asc'},
        select: {
          id: true,
          kind: true,
          title: true,
          createdById: true,
          roomUsers: {
            select: {userId: true},
          },
        },
      });
    }
  }

  if (!room) {
    throw new Error('failed_to_create_group_room');
  }

  return mapRoom(room);
}

export async function getRoomById(roomId: number): Promise<RoomRow | null> {
  const row = await db.room.findUnique({
    where: {id: roomId},
    select: {
      id: true,
      kind: true,
      title: true,
      createdById: true,
      roomUsers: {
        select: {userId: true},
      },
    },
  });

  if (!row) return null;
  return mapRoom(row);
}

async function findExistingDirectRoom(firstUserId: number, secondUserId: number) {
  return db.room.findFirst({
    where: {
      kind: 'direct',
      roomUsers: {
        some: {userId: firstUserId},
      },
      AND: [
        {
          roomUsers: {
            some: {userId: secondUserId},
          },
        },
        {
          roomUsers: {
            every: {
              userId: {
                in: [firstUserId, secondUserId],
              },
            },
          },
        },
      ],
    },
    orderBy: {id: 'asc'},
    select: {
      id: true,
      kind: true,
      title: true,
      createdById: true,
      roomUsers: {
        select: {userId: true},
      },
    },
  });
}

export async function getOrCreateDirectRoom(firstUserId: number, secondUserId: number): Promise<RoomRow> {
  let room = await findExistingDirectRoom(firstUserId, secondUserId);

  if (!room) {
    try {
      room = await db.$transaction(async (tx) => {
        const created = await tx.room.create({
          data: {
            kind: 'direct',
          },
          select: {
            id: true,
            kind: true,
            title: true,
            createdById: true,
          },
        });

        await tx.roomUser.createMany({
          data: [
            {
              roomId: created.id,
              userId: firstUserId,
            },
            {
              roomId: created.id,
              userId: secondUserId,
            },
          ],
          skipDuplicates: true,
        });

        return {
          ...created,
          roomUsers: [{userId: firstUserId}, {userId: secondUserId}],
        };
      });
    } catch {
      room = await findExistingDirectRoom(firstUserId, secondUserId);
    }
  }

  if (!room) {
    throw new Error('failed_to_create_direct_room');
  }

  return mapRoom(room);
}

export async function ensureUserInRoom(roomId: number, userId: number) {
  await ensureRoomMembership(roomId, userId);
}

export function userCanAccessRoom(userId: number, room: RoomRow) {
  return room.member_user_ids.includes(userId);
}
