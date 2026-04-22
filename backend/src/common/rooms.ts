import {db} from '../db.js';
import {getLatestScriptDefinition} from '../scriptable/registry.js';

export type RoomKind = 'group' | 'direct' | 'game';
export type RoomAppType = 'llm' | 'poll' | 'dashboard' | 'bot_control' | 'custom';

export type RoomRow = {
  id: number;
  kind: RoomKind;
  title: string | null;
  created_by: number | null;
  pinned_message_id: number | null;
  app_enabled: boolean;
  app_type: RoomAppType | null;
  app_config_json: Record<string, any>;
  member_user_ids: number[];
};

type RoomWithUsers = {
  id: number;
  kind: RoomKind;
  title: string | null;
  createdById: number | null;
  pinnedMessageId: number | null;
  appEnabled: boolean;
  appType: RoomAppType | null;
  appConfigJson: any;
  roomUsers: Array<{userId: number}>;
};

function cloneJson<T>(value: T): T {
  try {
    return JSON.parse(JSON.stringify(value)) as T;
  } catch {
    return value;
  }
}

function normalizeRoomAppType(raw: unknown): RoomAppType | null {
  const appType = String(raw || '').trim().toLowerCase();
  if (appType === 'llm' || appType === 'poll' || appType === 'dashboard' || appType === 'bot_control' || appType === 'custom') {
    return appType;
  }
  return null;
}

function normalizeRoomAppConfig(raw: unknown) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {};
  }
  return cloneJson(raw as Record<string, any>);
}

function mapRoom(row: RoomWithUsers): RoomRow {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title || null,
    created_by: row.createdById,
    pinned_message_id: row.pinnedMessageId || null,
    app_enabled: !!row.appEnabled,
    app_type: normalizeRoomAppType(row.appType),
    app_config_json: normalizeRoomAppConfig(row.appConfigJson),
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

export async function getOrCreateGroupRoom(createdByIdRaw?: number): Promise<RoomRow> {
  const createdById = Number(createdByIdRaw || 0);
  const canAssignCreator = Number.isFinite(createdById) && createdById > 0;

  let room = await db.room.findFirst({
    where: {kind: 'group'},
    orderBy: {id: 'asc'},
    select: {
      id: true,
      kind: true,
      title: true,
      createdById: true,
      pinnedMessageId: true,
      appEnabled: true,
      appType: true,
      appConfigJson: true,
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
          ...(canAssignCreator ? {createdById} : {}),
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
          pinnedMessageId: true,
          appEnabled: true,
          appType: true,
          appConfigJson: true,
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
          pinnedMessageId: true,
          appEnabled: true,
          appType: true,
          appConfigJson: true,
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
      pinnedMessageId: true,
      appEnabled: true,
      appType: true,
      appConfigJson: true,
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
      pinnedMessageId: true,
      appEnabled: true,
      appType: true,
      appConfigJson: true,
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
            pinnedMessageId: true,
            appEnabled: true,
            appType: true,
            appConfigJson: true,
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
          appEnabled: false,
          appType: null,
          appConfigJson: {},
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

export async function createPublicGroupRoom(createdById: number, titleRaw?: unknown): Promise<RoomRow> {
  const title = String(titleRaw || '').trim();
  const normalizedTitle = title ? title.slice(0, 120) : null;

  const room = await db.$transaction(async (tx) => {
    const created = await tx.room.create({
      data: {
        kind: 'group',
        title: normalizedTitle,
        createdById,
        appEnabled: false,
        appType: null,
        appConfigJson: {},
      },
      select: {
        id: true,
        kind: true,
        title: true,
        createdById: true,
        pinnedMessageId: true,
        appEnabled: true,
        appType: true,
        appConfigJson: true,
      },
    });

    const users = await tx.user.findMany({
      select: {id: true},
    });

    if (users.length > 0) {
      await tx.roomUser.createMany({
        data: users.map((user) => ({
          roomId: created.id,
          userId: user.id,
        })),
        skipDuplicates: true,
      });
    }

    return {
      ...created,
      roomUsers: users.map((user) => ({userId: user.id})),
    };
  });

  return mapRoom(room);
}

export function userCanAccessRoom(userId: number, room: RoomRow) {
  return room.member_user_ids.includes(userId);
}

export function userIsRoomAdmin(userIdRaw: unknown, room: RoomRow) {
  const userId = Number(userIdRaw || 0);
  if (!Number.isFinite(userId) || userId <= 0) return false;
  if (room.kind === 'direct') return false;
  return Number(room.created_by || 0) > 0 && Number(room.created_by) === userId;
}
