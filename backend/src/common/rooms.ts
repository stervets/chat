import {db} from '../db.js';
import {
  cloneJson,
  createRoomNode,
  type RoomAppType,
  type RoomKind,
  readRoomApp,
} from './nodes.js';

export type {RoomAppType, RoomKind} from './nodes.js';

export type RoomRow = {
  id: number;
  kind: RoomKind;
  title: string | null;
  created_by: number | null;
  pinned_node_id: number | null;
  pinned_message_id: number | null;
  app_enabled: boolean;
  app_type: RoomAppType | null;
  app_config_json: Record<string, any>;
  component: string | null;
  client_script: string | null;
  server_script: string | null;
  data: Record<string, any>;
  member_user_ids: number[];
};

type RoomWithUsers = {
  id: number;
  kind: string;
  title: string | null;
  pinnedNodeId: number | null;
  node: {
    createdById: number | null;
    component: string | null;
    clientScript: string | null;
    serverScript: string | null;
    data: any;
  };
  roomUsers: Array<{userId: number}>;
};

function mapRoom(row: RoomWithUsers): RoomRow {
  const roomApp = readRoomApp({
    data: row.node?.data || {},
  });

  return {
    id: row.id,
    kind: row.kind === 'direct' || row.kind === 'game' || row.kind === 'comment' ? row.kind : 'group',
    title: row.title || null,
    created_by: Number(row.node?.createdById || 0) || null,
    pinned_node_id: Number(row.pinnedNodeId || 0) || null,
    pinned_message_id: Number(row.pinnedNodeId || 0) || null,
    app_enabled: !!roomApp.enabled,
    app_type: roomApp.type,
    app_config_json: cloneJson(roomApp.config || {}),
    component: row.node?.component || null,
    client_script: row.node?.clientScript || null,
    server_script: row.node?.serverScript || null,
    data: cloneJson(row.node?.data || {}),
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

function roomSelect() {
  return {
    id: true,
    kind: true,
    title: true,
    pinnedNodeId: true,
    node: {
      select: {
        createdById: true,
        component: true,
        clientScript: true,
        serverScript: true,
        data: true,
      },
    },
    roomUsers: {
      select: {
        userId: true,
      },
    },
  } as const;
}

export async function ensureUserInGroupRooms(userId: number) {
  const groupRooms = await db.room.findMany({
    where: {
      kind: 'group',
    },
    select: {
      id: true,
    },
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
    where: {
      kind: 'group',
      node: {
        parentId: null,
      },
    },
    orderBy: {
      id: 'asc',
    },
    select: roomSelect(),
  }) as RoomWithUsers | null;

  if (!room) {
    try {
      room = await db.$transaction(async (tx) => {
        const created = await createRoomNode(tx, {
          kind: 'group',
          title: 'Общий чат',
          createdById: canAssignCreator ? createdById : null,
          nodeData: {},
        });

        const users = await tx.user.findMany({
          select: {
            id: true,
          },
        });

        if (users.length > 0) {
          await tx.roomUser.createMany({
            data: users.map((user) => ({
              roomId: created.room.id,
              userId: user.id,
            })),
            skipDuplicates: true,
          });
        }

        return {
          id: created.room.id,
          kind: created.room.kind,
          title: created.room.title,
          pinnedNodeId: created.room.pinnedNodeId,
          node: {
            createdById: created.node.createdById,
            component: created.node.component,
            clientScript: created.node.clientScript,
            serverScript: created.node.serverScript,
            data: created.node.data,
          },
          roomUsers: users.map((user) => ({userId: user.id})),
        } satisfies RoomWithUsers;
      });
    } catch {
      room = await db.room.findFirst({
        where: {
          kind: 'group',
          node: {
            parentId: null,
          },
        },
        orderBy: {
          id: 'asc',
        },
        select: roomSelect(),
      }) as RoomWithUsers | null;
    }
  }

  if (!room) {
    throw new Error('failed_to_create_group_room');
  }

  return mapRoom(room);
}

export async function getRoomById(roomId: number): Promise<RoomRow | null> {
  const row = await db.room.findUnique({
    where: {
      id: roomId,
    },
    select: roomSelect(),
  }) as RoomWithUsers | null;

  if (!row) return null;
  return mapRoom(row);
}

async function findExistingDirectRoom(firstUserId: number, secondUserId: number) {
  return db.room.findFirst({
    where: {
      kind: 'direct',
      roomUsers: {
        some: {
          userId: firstUserId,
        },
      },
      AND: [
        {
          roomUsers: {
            some: {
              userId: secondUserId,
            },
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
    orderBy: {
      id: 'asc',
    },
    select: roomSelect(),
  }) as Promise<RoomWithUsers | null>;
}

export async function getOrCreateDirectRoom(firstUserId: number, secondUserId: number): Promise<RoomRow> {
  let room = await findExistingDirectRoom(firstUserId, secondUserId);

  if (!room) {
    try {
      room = await db.$transaction(async (tx) => {
        const created = await createRoomNode(tx, {
          kind: 'direct',
          title: null,
          createdById: null,
          nodeData: {},
        });

        await tx.roomUser.createMany({
          data: [
            {
              roomId: created.room.id,
              userId: firstUserId,
            },
            {
              roomId: created.room.id,
              userId: secondUserId,
            },
          ],
          skipDuplicates: true,
        });

        return {
          id: created.room.id,
          kind: created.room.kind,
          title: created.room.title,
          pinnedNodeId: created.room.pinnedNodeId,
          node: {
            createdById: created.node.createdById,
            component: created.node.component,
            clientScript: created.node.clientScript,
            serverScript: created.node.serverScript,
            data: created.node.data,
          },
          roomUsers: [{userId: firstUserId}, {userId: secondUserId}],
        } satisfies RoomWithUsers;
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
    const created = await createRoomNode(tx, {
      kind: 'group',
      title: normalizedTitle,
      createdById,
      nodeData: {},
    });

    const users = await tx.user.findMany({
      select: {
        id: true,
      },
    });

    if (users.length > 0) {
      await tx.roomUser.createMany({
        data: users.map((user) => ({
          roomId: created.room.id,
          userId: user.id,
        })),
        skipDuplicates: true,
      });
    }

    return {
      id: created.room.id,
      kind: created.room.kind,
      title: created.room.title,
      pinnedNodeId: created.room.pinnedNodeId,
      node: {
        createdById: created.node.createdById,
        component: created.node.component,
        clientScript: created.node.clientScript,
        serverScript: created.node.serverScript,
        data: created.node.data,
      },
      roomUsers: users.map((user) => ({userId: user.id})),
    } satisfies RoomWithUsers;
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
