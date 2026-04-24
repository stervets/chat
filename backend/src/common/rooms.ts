import {db} from '../db.js';
import {
  cloneJson,
  createRoomNode,
  type RoomSurfaceType,
  type RoomKind,
  readRoomSurface,
} from './nodes.js';

export type {RoomSurfaceType, RoomKind} from './nodes.js';

export type RoomRow = {
  id: number;
  kind: RoomKind;
  title: string | null;
  visibility: 'public' | 'private';
  comments_enabled: boolean;
  avatar_path: string | null;
  post_only_by_admin: boolean;
  created_by: number | null;
  pinned_node_id: number | null;
  surface_enabled: boolean;
  surface_type: RoomSurfaceType | null;
  surface_config_json: Record<string, any>;
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
  visibility: string;
  commentsEnabled: boolean;
  avatarPath: string | null;
  postOnlyByAdmin: boolean;
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

type RoomCreateLockState = {
  tail: Promise<void>;
  pending: number;
};

const roomCreateLocks = new Map<string, RoomCreateLockState>();
const DEFAULT_GROUP_ROOM_LOCK_KEY = 'group:default';

async function withRoomCreateLock<T>(lockKey: string, action: () => Promise<T>) {
  let state = roomCreateLocks.get(lockKey);
  if (!state) {
    state = {
      tail: Promise.resolve(),
      pending: 0,
    };
    roomCreateLocks.set(lockKey, state);
  }

  state.pending += 1;
  const waitForTurn = state.tail.catch(() => {});
  let releaseLock: () => void = () => {};
  const turnFinished = new Promise<void>((resolve) => {
    releaseLock = resolve;
  });

  state.tail = waitForTurn.then(() => turnFinished);
  await waitForTurn;

  try {
    return await action();
  } finally {
    releaseLock();
    state.pending -= 1;
    if (state.pending <= 0) {
      roomCreateLocks.delete(lockKey);
    }
  }
}

function buildDirectRoomLockKey(firstUserId: number, secondUserId: number) {
  const minUserId = Math.min(firstUserId, secondUserId);
  const maxUserId = Math.max(firstUserId, secondUserId);
  return `direct:${minUserId}:${maxUserId}`;
}

function mapRoom(row: RoomWithUsers): RoomRow {
  const roomSurface = readRoomSurface({
    data: row.node?.data || {},
  });

  return {
    id: row.id,
    kind: row.kind === 'direct' || row.kind === 'game' || row.kind === 'comment' ? row.kind : 'group',
    title: row.title || null,
    visibility: normalizeRoomVisibility(row.visibility),
    comments_enabled: !!row.commentsEnabled,
    avatar_path: row.avatarPath?.trim() ? row.avatarPath.trim() : null,
    post_only_by_admin: !!row.postOnlyByAdmin,
    created_by: Number(row.node?.createdById || 0) || null,
    pinned_node_id: Number(row.pinnedNodeId || 0) || null,
    surface_enabled: !!roomSurface.enabled,
    surface_type: roomSurface.type,
    surface_config_json: cloneJson(roomSurface.config || {}),
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
    visibility: true,
    commentsEnabled: true,
    avatarPath: true,
    postOnlyByAdmin: true,
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

export function normalizeRoomVisibility(raw: unknown): 'public' | 'private' {
  return String(raw || '').trim().toLowerCase() === 'private'
    ? 'private'
    : 'public';
}

export async function ensureUserInGroupRooms(userId: number) {
  const defaultRoom = await getOrCreateGroupRoom(userId);
  await ensureRoomMembership(defaultRoom.id, userId);
}

export async function getOrCreateGroupRoom(createdByIdRaw?: number): Promise<RoomRow> {
  return withRoomCreateLock(DEFAULT_GROUP_ROOM_LOCK_KEY, async () => {
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

          await tx.room.update({
            where: {
              id: created.room.id,
            },
            data: {
              visibility: 'public',
              commentsEnabled: true,
            },
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
            visibility: 'public',
            commentsEnabled: true,
            avatarPath: null,
            postOnlyByAdmin: false,
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
  });
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
  const lockKey = buildDirectRoomLockKey(firstUserId, secondUserId);
  return withRoomCreateLock(lockKey, async () => {
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
            visibility: 'private',
            commentsEnabled: true,
            avatarPath: null,
            postOnlyByAdmin: false,
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
  });
}

export async function ensureUserInRoom(roomId: number, userId: number) {
  await ensureRoomMembership(roomId, userId);
}

export async function createPublicGroupRoom(createdById: number, titleRaw?: unknown): Promise<RoomRow> {
  return createGroupRoom(createdById, {
    title: titleRaw,
    visibility: 'public',
    commentsEnabled: true,
    avatarPath: null,
    postOnlyByAdmin: false,
  });
}

export async function createGroupRoom(
  createdById: number,
  inputRaw?: {
    title?: unknown;
    visibility?: unknown;
    commentsEnabled?: unknown;
    avatarPath?: unknown;
    postOnlyByAdmin?: unknown;
  },
): Promise<RoomRow> {
  const title = String(inputRaw?.title || '').trim();
  const normalizedTitle = title ? title.slice(0, 120) : null;
  const visibility = normalizeRoomVisibility(inputRaw?.visibility);
  const commentsEnabled = inputRaw?.commentsEnabled !== undefined
    ? !!inputRaw.commentsEnabled
    : true;
  const avatarPath = String(inputRaw?.avatarPath || '').trim() || null;
  const postOnlyByAdmin = !!inputRaw?.postOnlyByAdmin;

  const room = await db.$transaction(async (tx) => {
    const created = await createRoomNode(tx, {
      kind: 'group',
      title: normalizedTitle,
      createdById,
      nodeData: {},
    });

    await tx.room.update({
      where: {
        id: created.room.id,
      },
      data: {
        visibility,
        commentsEnabled,
        avatarPath,
        postOnlyByAdmin,
      },
    });

    await tx.roomUser.create({
      data: {
        roomId: created.room.id,
        userId: createdById,
      },
    });

    return {
      id: created.room.id,
      kind: created.room.kind,
      title: created.room.title,
      visibility,
      commentsEnabled,
      avatarPath,
      postOnlyByAdmin,
      pinnedNodeId: created.room.pinnedNodeId,
      node: {
        createdById: created.node.createdById,
        component: created.node.component,
        clientScript: created.node.clientScript,
        serverScript: created.node.serverScript,
        data: created.node.data,
      },
      roomUsers: [{userId: createdById}],
    } satisfies RoomWithUsers;
  });

  return mapRoom(room);
}

export function userCanAccessRoom(userId: number, room: RoomRow) {
  if (room.kind === 'group' || room.kind === 'game') {
    if (room.visibility === 'public') return true;
  }
  return room.member_user_ids.includes(userId);
}

export function userIsRoomAdmin(userIdRaw: unknown, room: RoomRow) {
  const userId = Number(userIdRaw || 0);
  if (!Number.isFinite(userId) || userId <= 0) return false;
  if (room.kind === 'direct') return false;
  return Number(room.created_by || 0) > 0 && Number(room.created_by) === userId;
}
