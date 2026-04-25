import {Prisma} from '@prisma/client';
import {db} from '../../db.js';
import {
  createGroupRoom,
  ensureUserInRoom,
  getRoomById,
  getOrCreateDirectRoom,
  getOrCreateGroupRoom,
  normalizeRoomVisibility,
  userCanAccessRoom,
  userIsRoomAdmin,
  type RoomRow,
} from '../../common/rooms.js';
import {
  cloneJson,
} from '../../common/nodes.js';
import {
  ChatContext,
  SYSTEM_NICKNAME,
  type ApiError,
  type ApiOk,
  type PublicUser,
} from './chat-context.js';
import type {SocketState} from '../protocol.js';

type RoomRuntimeRow = {
  id: number;
  pinnedNodeId: number | null;
  node: {
    component: string | null;
    clientScript: string | null;
    serverScript: string | null;
    data: any;
  };
};

type RoomSurfacePayload = {
  enabled: false;
  type: null;
  config: Record<string, any>;
  pinnedNodeId: number | null;
  pinnedKind: 'text' | 'system' | null;
  hasRoomRuntime: false;
  requiresRoomRuntime: false;
};

type DiscussionPayload = {
  sourceMessageId: number | null;
  sourceRoomId: number | null;
  sourceRoomKind: 'group' | 'direct' | 'game' | 'comment' | null;
  sourceRoomTitle: string | null;
  sourceRoomAvatarUrl: string | null;
  sourceMessagePreview: string;
  sourceMessageDeleted: boolean;
};

function normalizeAppConfig(raw: unknown) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  return cloneJson(raw as Record<string, any>);
}

function publicUserSelect() {
  return {
    id: true,
    nickname: true,
    name: true,
    info: true,
    avatarPath: true,
    nicknameColor: true,
    donationBadgeUntil: true,
    pushDisableAllMentions: true,
  } as const;
}

export class ChatDialogsService {
  constructor(private readonly ctx: ChatContext) {}

  private async isMarxNewsRoom(roomIdRaw: unknown) {
    const roomId = Number(roomIdRaw || 0);
    if (!Number.isFinite(roomId) || roomId <= 0) return false;

    const room = await db.room.findUnique({
      where: {
        id: roomId,
      },
      select: {
        title: true,
        postOnlyByAdmin: true,
      },
    });

    return !!room
      && !!room.postOnlyByAdmin
      && String(room.title || '').trim() === 'Новости MARX';
  }

  private async loadDirectTargetUser(roomId: number, viewerUserId: number) {
    const membership = await db.roomUser.findFirst({
      where: {
        roomId,
        userId: {
          not: viewerUserId,
        },
      },
      select: {
        user: {
          select: publicUserSelect(),
        },
      },
    });

    return membership?.user ? this.ctx.toPublicUser(membership.user) : null;
  }

  private buildDiscussionPreview(rawTextRaw: unknown) {
    const preview = String(rawTextRaw || '').replace(/\s+/g, ' ').trim();
    if (!preview) return '(пусто)';
    if (preview.length <= 220) return preview;
    return `${preview.slice(0, 217)}...`;
  }

  private toRoomRuntimePayload(_roomId: number, _roomRuntime: RoomRuntimeRow | null) {
    return null;
  }

  private toRoomSurfacePayload(
    room: RoomRow,
    _roomRuntime: RoomRuntimeRow | null,
    pinnedMessage: any | null,
    pinnedNodeIdRaw?: unknown,
  ): RoomSurfacePayload {
    const pinnedNodeId = Number(pinnedMessage?.id || pinnedNodeIdRaw || room.pinned_node_id || 0) || null;
    const pinnedKindRaw = pinnedMessage && typeof pinnedMessage === 'object'
      ? String(pinnedMessage.kind || '').trim().toLowerCase()
      : '';
    const pinnedKind = pinnedKindRaw === 'text' || pinnedKindRaw === 'system'
      ? pinnedKindRaw
      : null;

    return {
      enabled: false,
      type: null,
      config: normalizeAppConfig({}),
      pinnedNodeId,
      pinnedKind,
      hasRoomRuntime: false,
      requiresRoomRuntime: false,
    };
  }

  private async loadRoomRuntime(roomId: number) {
    return db.room.findUnique({
      where: {id: roomId},
      select: {
        id: true,
        pinnedNodeId: true,
        node: {
          select: {
            component: true,
            clientScript: true,
            serverScript: true,
            data: true,
          },
        },
      },
    }) as Promise<RoomRuntimeRow | null>;
  }

  private async loadDiscussionPayload(roomId: number, roomKind: RoomRow['kind']): Promise<DiscussionPayload | null> {
    if (roomKind !== 'comment') return null;

    const room = await db.room.findUnique({
      where: {
        id: roomId,
      },
      select: {
        node: {
          select: {
            parentId: true,
          },
        },
      },
    });

    const sourceMessageId = Number(room?.node?.parentId || 0);
    if (!Number.isFinite(sourceMessageId) || sourceMessageId <= 0) return null;

    const sourceMessage = await db.message.findUnique({
      where: {
        id: sourceMessageId,
      },
      select: {
        id: true,
        rawText: true,
        node: {
          select: {
            parentId: true,
          },
        },
      },
    });

    if (!sourceMessage) {
      return {
        sourceMessageId,
        sourceRoomId: null,
        sourceRoomKind: null,
        sourceRoomTitle: null,
        sourceRoomAvatarUrl: null,
        sourceMessagePreview: '',
        sourceMessageDeleted: true,
      };
    }

    const sourceRoomId = Number(sourceMessage.node?.parentId || 0) || null;
    const sourceRoom = sourceRoomId
      ? await db.room.findUnique({
        where: {id: sourceRoomId},
        select: {
          kind: true,
          title: true,
          avatarPath: true,
        },
      })
      : null;

    return {
      sourceMessageId,
      sourceRoomId,
      sourceRoomKind: (sourceRoom?.kind as DiscussionPayload['sourceRoomKind']) || null,
      sourceRoomTitle: sourceRoom?.title || null,
      sourceRoomAvatarUrl: this.ctx.toRoomAvatarUrl(sourceRoom?.avatarPath),
      sourceMessagePreview: this.buildDiscussionPreview(sourceMessage.rawText),
      sourceMessageDeleted: false,
    };
  }

  async roomGetDefaultGroup(state: SocketState): Promise<ApiError | {
    roomId: number;
    dialogId: number;
    type: 'group';
    joined: boolean;
    title: string;
    visibility: 'public' | 'private';
    commentsEnabled: boolean;
    avatarUrl: string | null;
    postOnlyByAdmin: boolean;
    createdById: number | null;
    pinnedNodeId: number | null;
    roomSurface: RoomSurfacePayload;
  }> {
    const authError = this.ctx.requireAuth(state);
    if (authError) return authError;

    const room = await getOrCreateGroupRoom(state.user!.id);
    const roomRuntime = await this.loadRoomRuntime(room.id);
    return {
      roomId: room.id,
      dialogId: room.id,
      type: 'group',
      joined: room.member_user_ids.includes(state.user!.id),
      title: room.title || 'Общий чат',
      visibility: room.visibility,
      commentsEnabled: room.comments_enabled,
      avatarUrl: this.ctx.toRoomAvatarUrl(room.avatar_path),
      postOnlyByAdmin: !!room.post_only_by_admin,
      createdById: room.created_by || null,
      pinnedNodeId: room.pinned_node_id || null,
      roomSurface: this.toRoomSurfacePayload(room, roomRuntime, null, roomRuntime?.pinnedNodeId),
    };
  }

  async roomDirectGetOrCreate(state: SocketState, userIdRaw: unknown): Promise<ApiError | {
    roomId: number;
    dialogId: number;
    type: 'direct';
    targetUser: PublicUser;
    createdById: null;
    pinnedNodeId: number | null;
    roomSurface: RoomSurfacePayload;
  }> {
    const authError = this.ctx.requireAuth(state);
    if (authError) return authError;

    const userId = Number.parseInt(String(userIdRaw ?? ''), 10);
    if (!Number.isFinite(userId)) {
      return {ok: false, error: 'invalid_user'};
    }

    if (userId === state.user!.id) {
      return {ok: false, error: 'self_dialog'};
    }

    const targetUser = await db.user.findUnique({
      where: {id: userId},
      select: publicUserSelect(),
    });

    if (!targetUser) {
      return {ok: false, error: 'user_not_found'};
    }

    const room = await getOrCreateDirectRoom(state.user!.id, userId);
    return {
      roomId: room.id,
      dialogId: room.id,
      type: 'direct',
      targetUser: this.ctx.toPublicUser(targetUser),
      createdById: null,
      pinnedNodeId: null,
      roomSurface: this.toRoomSurfacePayload(room, null, null),
    };
  }

  async roomListDirect(state: SocketState): Promise<ApiError | Array<{
    roomId: number;
    dialogId: number;
    targetUser: PublicUser;
    lastMessageAt: string;
    createdById: null;
    pinnedNodeId: number | null;
    roomSurface: RoomSurfacePayload;
  }>> {
    const authError = this.ctx.requireAuth(state);
    if (authError) return authError;

    const userId = state.user!.id;

    const rows = await db.room.findMany({
      where: {
        kind: 'direct',
        roomUsers: {
          some: {userId},
        },
      },
      include: {
        node: {
          select: {
            data: true,
            component: true,
            clientScript: true,
            serverScript: true,
          },
        },
        roomUsers: {
          include: {
            user: {
              select: publicUserSelect(),
            },
          },
        },
      },
    });

    const roomIds = rows.map((row) => row.id);
    const lastMessageRows = roomIds.length > 0
      ? await db.$queryRaw<Array<{roomId: number; createdAt: Date}>>(Prisma.sql`
        select distinct on (n.parent_id)
          n.parent_id as "roomId",
          m.created_at as "createdAt"
        from messages m
        join nodes n on n.id = m.id
        where n.parent_id in (${Prisma.join(roomIds)})
        order by n.parent_id, m.created_at desc, m.id desc
      `)
      : [];

    const lastMessageAtByRoomId = new Map<number, string>();
    lastMessageRows.forEach((row) => {
      lastMessageAtByRoomId.set(
        Number(row.roomId || 0),
        row.createdAt instanceof Date ? row.createdAt.toISOString() : new Date(row.createdAt).toISOString(),
      );
    });

    const mapped = rows.map((row) => {
      const targetMember = row.roomUsers.find((member) => member.userId !== userId);
      const targetUser = targetMember?.user;
      if (!targetUser) return null;

      return {
        roomId: row.id,
        dialogId: row.id,
        lastMessageAt: lastMessageAtByRoomId.get(row.id) || new Date(0).toISOString(),
        targetUser: this.ctx.toPublicUser(targetUser),
        createdById: null,
        pinnedNodeId: null,
        roomSurface: this.toRoomSurfacePayload({
          id: row.id,
          kind: 'direct',
          title: row.title || null,
          visibility: 'private',
          comments_enabled: true,
          avatar_path: null,
          post_only_by_admin: false,
          created_by: null,
          pinned_node_id: null,
          surface_enabled: false,
          surface_type: null,
          surface_config_json: {},
          component: row.node?.component || null,
          client_script: row.node?.clientScript || null,
          server_script: row.node?.serverScript || null,
          data: cloneJson((row.node?.data || {}) as Record<string, any>),
          member_user_ids: [],
        }, null, null),
      };
    }).filter(Boolean) as Array<{
      roomId: number;
      dialogId: number;
      targetUser: PublicUser;
      lastMessageAt: string;
      createdById: null;
      pinnedNodeId: number | null;
      roomSurface: RoomSurfacePayload;
    }>;

    const systemUser = await db.user.findUnique({
      where: {
        nickname: SYSTEM_NICKNAME,
      },
      select: publicUserSelect(),
    });

    if (systemUser && systemUser.id !== userId) {
      const systemRoom = await getOrCreateDirectRoom(userId, systemUser.id);
      const alreadyPresent = mapped.some((item) => item.roomId === systemRoom.id);
      if (!alreadyPresent) {
        mapped.push({
          roomId: systemRoom.id,
          dialogId: systemRoom.id,
          targetUser: this.ctx.toPublicUser(systemUser),
          lastMessageAt: new Date(0).toISOString(),
          createdById: null,
          pinnedNodeId: null,
          roomSurface: this.toRoomSurfacePayload(systemRoom, null, null),
        });
      }
    }

    mapped.sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt));
    return mapped;
  }

  async roomListJoined(
    state: SocketState,
    scopeRaw?: unknown,
  ): Promise<ApiError | Array<{
    roomId: number;
    dialogId: number;
    kind: 'group';
    title: string;
    visibility: 'public' | 'private';
    commentsEnabled: boolean;
    avatarUrl: string | null;
    postOnlyByAdmin: boolean;
    createdById: number | null;
    pinnedNodeId: number | null;
    joined: boolean;
    roomSurface: RoomSurfacePayload;
  }>> {
    const authError = this.ctx.requireAuth(state);
    if (authError) return authError;

    const scope = String(scopeRaw || 'all').trim().toLowerCase();
    const userId = state.user!.id;
    const rows = await db.room.findMany({
      where: {
        kind: 'group',
        ...(scope === 'joined'
          ? {
            roomUsers: {
              some: {userId},
            },
          }
          : scope === 'public'
            ? {
              visibility: 'public',
            }
            : {
              OR: [
                {visibility: 'public'},
                {
                  roomUsers: {
                    some: {userId},
                  },
                },
              ],
            }),
      },
      orderBy: [
        {id: 'asc'},
      ],
      include: {
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
      },
    });

    return rows.map((row) => {
      const room: RoomRow = {
        id: row.id,
        kind: 'group',
        title: row.title || null,
        visibility: normalizeRoomVisibility(row.visibility),
        comments_enabled: !!row.commentsEnabled,
        avatar_path: row.avatarPath?.trim() ? row.avatarPath.trim() : null,
        post_only_by_admin: !!row.postOnlyByAdmin,
        created_by: Number(row.node?.createdById || 0) || null,
        pinned_node_id: Number(row.pinnedNodeId || 0) || null,
        surface_enabled: false,
        surface_type: null,
        surface_config_json: {},
        component: row.node?.component || null,
        client_script: row.node?.clientScript || null,
        server_script: row.node?.serverScript || null,
        data: cloneJson((row.node?.data || {}) as Record<string, any>),
        member_user_ids: row.roomUsers.map((item) => item.userId),
      };

      return {
        roomId: row.id,
        dialogId: row.id,
        kind: 'group' as const,
        title: row.title || 'Комната',
        visibility: room.visibility,
        commentsEnabled: room.comments_enabled,
        avatarUrl: this.ctx.toRoomAvatarUrl(room.avatar_path),
        postOnlyByAdmin: !!room.post_only_by_admin,
        createdById: room.created_by,
        pinnedNodeId: room.pinned_node_id,
        joined: room.member_user_ids.includes(userId),
        roomSurface: this.toRoomSurfacePayload(room, null, null, room.pinned_node_id),
      };
    });
  }

  async messageList(
    state: SocketState,
    roomIdRaw: unknown,
    limitRaw?: unknown,
    beforeMessageIdRaw?: unknown,
  ): Promise<ApiError | any[]> {
    const authError = this.ctx.requireAuth(state);
    if (authError) return authError;
    const roomId = this.ctx.parseRoomId(roomIdRaw);
    if (!roomId) {
      return {ok: false, error: 'invalid_room'};
    }

    const room = await getRoomById(roomId);
    if (!room) {
      return {ok: false, error: 'room_not_found'};
    }

    if (!userCanAccessRoom(state.user!.id, room)) {
      return {ok: false, error: 'forbidden'};
    }

    await this.ctx.pruneRoomOverflow(roomId);
    const limit = this.ctx.parseLimit(limitRaw);
    const beforeMessageId = this.ctx.parseBeforeMessageId(beforeMessageIdRaw);

    const result = await db.message.findMany({
      where: {
        node: {
          parentId: roomId,
        },
        ...(beforeMessageId ? {id: {lt: beforeMessageId}} : {}),
      },
      orderBy: [
        {createdAt: 'desc'},
        {id: 'desc'},
      ],
      take: limit,
      select: {
        id: true,
        senderId: true,
        kind: true,
        rawText: true,
        renderedHtml: true,
        createdAt: true,
        node: {
          select: {
            clientScript: true,
            serverScript: true,
            data: true,
          },
        },
        sender: {
          select: {
            id: true,
            nickname: true,
            name: true,
            avatarPath: true,
            nicknameColor: true,
            donationBadgeUntil: true,
          },
        },
      },
    });

    const discussionRooms = await db.room.findMany({
      where: {
        kind: 'comment',
        node: {
          parentId: {
            in: result.map((row) => row.id),
          },
        },
      },
      select: {
        id: true,
        node: {
          select: {
            parentId: true,
          },
        },
      },
    });

    const discussionByMessageId = new Map<number, number>();
    discussionRooms.forEach((row) => {
      const messageId = Number(row.node?.parentId || 0);
      if (!Number.isFinite(messageId) || messageId <= 0) return;
      discussionByMessageId.set(messageId, row.id);
    });

    const discussionRoomIds = discussionRooms.map((row) => row.id);
    const commentCountByRoomId = new Map<number, number>();
    if (discussionRoomIds.length > 0) {
      const commentCounts = await db.$queryRaw<Array<{roomId: number; count: bigint | number}>>(Prisma.sql`
        select
          n.parent_id as "roomId",
          count(*)::bigint as "count"
        from messages m
        join nodes n on n.id = m.id
        where n.parent_id in (${Prisma.join(discussionRoomIds)})
        group by n.parent_id
      `);
      commentCounts.forEach((row) => {
        commentCountByRoomId.set(Number(row.roomId || 0), Number(row.count || 0));
      });
    }

    const renderContext = await this.ctx.buildRoomMessageRenderContext(
      roomId,
      result.map((row) => String(row.rawText || '')),
    );

    const ordered = result.reverse().map((row) => {
      const sourceText = row.kind === 'scriptable'
        ? this.ctx.getDisabledScriptableFallbackText(row.rawText)
        : String(row.rawText || '');
      const compiled = this.ctx.compileMessageWithContext(
        sourceText,
        renderContext,
        row.id,
      );
      const author = this.ctx.toMessageAuthor({
        senderId: row.senderId,
        sender: row.sender,
      });

      return {
        id: row.id,
        roomId,
        dialogId: roomId,
        kind: row.kind === 'system' ? 'system' : 'text',
        authorId: author.authorId,
        authorNickname: author.authorNickname,
        authorName: author.authorName,
        authorAvatarUrl: author.authorAvatarUrl,
        authorNicknameColor: author.authorNicknameColor,
        authorDonationBadgeUntil: author.authorDonationBadgeUntil,
        rawText: compiled.rawText,
        renderedHtml: compiled.renderedHtml,
        renderedPreviews: compiled.renderedPreviews,
        runtime: {
          clientScript: null,
          serverScript: null,
          data: {},
        },
        commentRoomId: discussionByMessageId.get(row.id) || null,
        commentCount: commentCountByRoomId.get(discussionByMessageId.get(row.id) || 0) || 0,
        createdAt: row.createdAt.toISOString(),
      };
    });

    return this.ctx.attachMessageReactions(ordered);
  }

  async roomGet(state: SocketState, roomIdRaw: unknown): Promise<ApiError | ApiOk<{
    roomId: number;
    dialogId: number;
    kind: 'group' | 'direct' | 'game' | 'comment';
    title: string;
    joined: boolean;
    visibility: 'public' | 'private';
    commentsEnabled: boolean;
    avatarUrl: string | null;
    postOnlyByAdmin: boolean;
    createdById: number | null;
    roomRuntime: any | null;
    roomSurface: RoomSurfacePayload;
    discussion: DiscussionPayload | null;
    pinnedNodeId: number | null;
    pinnedMessage: any | null;
    targetUser?: PublicUser | null;
  }>> {
    const authError = this.ctx.requireAuth(state);
    if (authError) return authError;

    const roomId = this.ctx.parseRoomId(roomIdRaw);
    if (!roomId) {
      return {ok: false, error: 'invalid_room'};
    }

    let room = await getRoomById(roomId);
    if (!room) {
      return {ok: false, error: 'room_not_found'};
    }

    if (!userCanAccessRoom(state.user!.id, room)) {
      return {ok: false, error: 'forbidden'};
    }

    const roomRuntime = await this.loadRoomRuntime(roomId);

    state.roomId = roomId;
    const pinnedNodeId = Number(roomRuntime?.pinnedNodeId || 0);
    const pinnedMessage = pinnedNodeId > 0
      ? await this.ctx.loadMessagePayloadById(roomId, pinnedNodeId)
      : null;
    const discussion = await this.loadDiscussionPayload(roomId, room.kind);
    const directTargetUser = room.kind === 'direct'
      ? await this.loadDirectTargetUser(roomId, state.user!.id)
      : null;
    const resolvedTitle = room.kind === 'direct'
      ? String(directTargetUser?.name || directTargetUser?.nickname || room.title || 'Чат')
      : String(room.title || (room.kind === 'comment' ? 'Комментарии' : 'Комната'));
    const resolvedAvatarUrl = room.kind === 'direct'
      ? (directTargetUser?.avatarUrl || null)
      : this.ctx.toRoomAvatarUrl(room.avatar_path);

    return {
      ok: true,
      roomId,
      dialogId: roomId,
      kind: room.kind,
      title: resolvedTitle,
      joined: room.member_user_ids.includes(state.user!.id),
      visibility: room.visibility,
      commentsEnabled: room.comments_enabled,
      avatarUrl: resolvedAvatarUrl,
      postOnlyByAdmin: !!room.post_only_by_admin,
      createdById: room.created_by || null,
      roomSurface: this.toRoomSurfacePayload(
        room,
        roomRuntime,
        pinnedMessage,
        roomRuntime?.pinnedNodeId,
      ),
      discussion,
      pinnedNodeId: pinnedMessage?.id || (roomRuntime?.pinnedNodeId || null),
      pinnedMessage,
      roomRuntime: this.toRoomRuntimePayload(roomId, roomRuntime),
      targetUser: directTargetUser,
    };
  }

  async roomCreate(state: SocketState, payloadRaw: any): Promise<ApiError | ApiOk<{
    roomId: number;
    dialogId: number;
    kind: 'group';
    joined: true;
    title: string;
    visibility: 'public' | 'private';
    commentsEnabled: boolean;
    avatarUrl: string | null;
    postOnlyByAdmin: boolean;
    createdById: number;
    pinnedNodeId: null;
    roomSurface: RoomSurfacePayload;
  }>> {
    const authError = this.ctx.requireAuth(state);
    if (authError) return authError;

    const payload = payloadRaw && typeof payloadRaw === 'object' ? payloadRaw : {};
    const title = String(payload?.title || '').trim() || 'Комната';
    const avatarPath = this.ctx.parseRoomAvatarPath(payload?.avatarPath);
    if (!avatarPath.ok) {
      return {ok: false, error: avatarPath.error};
    }
    const room = await createGroupRoom(state.user!.id, {
      title,
      visibility: payload?.visibility,
      commentsEnabled: payload?.commentsEnabled,
      avatarPath: avatarPath.value ?? null,
      postOnlyByAdmin: !!payload?.postOnlyByAdmin,
    });

    return {
      ok: true,
      roomId: room.id,
      dialogId: room.id,
      kind: 'group',
      joined: true,
      title: room.title || 'Комната',
      visibility: room.visibility,
      commentsEnabled: room.comments_enabled,
      avatarUrl: this.ctx.toRoomAvatarUrl(room.avatar_path),
      postOnlyByAdmin: !!room.post_only_by_admin,
      createdById: Number(room.created_by || state.user!.id),
      pinnedNodeId: null,
      roomSurface: this.toRoomSurfacePayload(room, null, null),
    };
  }

  async roomJoin(state: SocketState, roomIdRaw: unknown): Promise<ApiError | ApiOk<{
    roomId: number;
    joined: boolean;
  }>> {
    const authError = this.ctx.requireAuth(state);
    if (authError) return authError;

    const roomId = this.ctx.parseRoomId(roomIdRaw);
    if (!roomId) {
      return {ok: false, error: 'invalid_room'};
    }

    const room = await getRoomById(roomId);
    if (!room) {
      return {ok: false, error: 'room_not_found'};
    }
    if (room.kind === 'direct' || room.kind === 'comment') {
      return {ok: false, error: 'forbidden'};
    }
    if (room.visibility !== 'public') {
      return {ok: false, error: 'forbidden'};
    }

    await ensureUserInRoom(roomId, state.user!.id);
    return {
      ok: true,
      roomId,
      joined: true,
    };
  }

  async roomLeave(state: SocketState, roomIdRaw: unknown): Promise<ApiError | ApiOk<{
    roomId: number;
    dialogId: number;
    kind: 'group' | 'game';
    left: boolean;
  }>> {
    const authError = this.ctx.requireAuth(state);
    if (authError) return authError;

    const roomId = this.ctx.parseRoomId(roomIdRaw);
    if (!roomId) {
      return {ok: false, error: 'invalid_room'};
    }

    const room = await getRoomById(roomId);
    if (!room || !userCanAccessRoom(state.user!.id, room)) {
      return {ok: false, error: 'forbidden'};
    }
    if (room.kind === 'direct' || room.kind === 'comment') {
      return {ok: false, error: 'forbidden'};
    }
    if (await this.isMarxNewsRoom(roomId)) {
      return {ok: false, error: 'forbidden'};
    }

    const result = await db.roomUser.deleteMany({
      where: {
        roomId,
        userId: state.user!.id,
      },
    });
    if (state.roomId === roomId) {
      state.roomId = null;
    }

    return {
      ok: true,
      roomId,
      dialogId: roomId,
      kind: room.kind === 'game' ? 'game' : 'group',
      left: result.count > 0,
    };
  }

  async roomMembersList(state: SocketState, roomIdRaw: unknown): Promise<ApiError | PublicUser[]> {
    const authError = this.ctx.requireAuth(state);
    if (authError) return authError;

    const roomId = this.ctx.parseRoomId(roomIdRaw);
    if (!roomId) {
      return {ok: false, error: 'invalid_room'};
    }

    const room = await getRoomById(roomId);
    if (!room || !userCanAccessRoom(state.user!.id, room)) {
      return {ok: false, error: 'forbidden'};
    }

    const rows = await db.roomUser.findMany({
      where: {
        roomId,
      },
      orderBy: {
        joinedAt: 'asc',
      },
      select: {
        user: {
          select: publicUserSelect(),
        },
      },
    });

    return rows.map((row) => this.ctx.toPublicUser(row.user));
  }

  async roomMembersAdd(state: SocketState, payloadRaw: any): Promise<ApiError | ApiOk<{addedUserIds: number[]}>> {
    const authError = this.ctx.requireAuth(state);
    if (authError) return authError;

    const roomId = this.ctx.parseRoomId(payloadRaw?.roomId);
    if (!roomId) {
      return {ok: false, error: 'invalid_room'};
    }

    const room = await getRoomById(roomId);
    if (!room || !userCanAccessRoom(state.user!.id, room)) {
      return {ok: false, error: 'forbidden'};
    }
    if (room.kind === 'direct' || room.kind === 'comment') {
      return {ok: false, error: 'forbidden'};
    }
    if (!userIsRoomAdmin(state.user!.id, room)) {
      return {ok: false, error: 'forbidden'};
    }

    const userIds: number[] = Array.isArray(payloadRaw?.userIds)
      ? Array.from(new Set(payloadRaw.userIds
        .map((value: unknown) => Number.parseInt(String(value ?? ''), 10))
        .filter((value: number) => Number.isFinite(value) && value > 0)))
      : [];
    if (!userIds.length) {
      return {ok: false, error: 'invalid_users'};
    }

    const existingUsers = await db.user.findMany({
      where: {
        id: {
          in: userIds,
        },
      },
      select: {
        id: true,
      },
    });
    const existingUserIds: number[] = existingUsers.map((row) => row.id);
    if (!existingUserIds.length) {
      return {ok: false, error: 'invalid_users'};
    }

    await db.roomUser.createMany({
      data: existingUserIds.map((userId) => ({
        roomId,
        userId,
      })),
      skipDuplicates: true,
    });

    return {
      ok: true,
      addedUserIds: existingUserIds,
    };
  }

  async roomMembersRemove(state: SocketState, payloadRaw: any): Promise<ApiError | ApiOk<{removedUserIds: number[]}>> {
    const authError = this.ctx.requireAuth(state);
    if (authError) return authError;

    const roomId = this.ctx.parseRoomId(payloadRaw?.roomId);
    if (!roomId) {
      return {ok: false, error: 'invalid_room'};
    }

    const room = await getRoomById(roomId);
    if (!room || !userCanAccessRoom(state.user!.id, room)) {
      return {ok: false, error: 'forbidden'};
    }
    if (room.kind === 'direct' || room.kind === 'comment') {
      return {ok: false, error: 'forbidden'};
    }
    if (!userIsRoomAdmin(state.user!.id, room)) {
      return {ok: false, error: 'forbidden'};
    }

    const requestedUserIds: number[] = Array.isArray(payloadRaw?.userIds)
      ? Array.from(new Set(payloadRaw.userIds
        .map((value: unknown) => Number.parseInt(String(value ?? ''), 10))
        .filter((value: number) => Number.isFinite(value) && value > 0)))
      : [];
    if (!requestedUserIds.length) {
      return {ok: false, error: 'invalid_users'};
    }

    const removableIds = requestedUserIds.filter((userId) => userId !== Number(room.created_by || 0));
    if (!removableIds.length) {
      return {
        ok: true,
        removedUserIds: [],
      };
    }

    const existingMembers = await db.roomUser.findMany({
      where: {
        roomId,
        userId: {
          in: removableIds,
        },
      },
      select: {
        userId: true,
      },
    });
    const memberIds = existingMembers.map((row) => Number(row.userId || 0)).filter((userId) => Number.isFinite(userId) && userId > 0);
    if (!memberIds.length) {
      return {
        ok: true,
        removedUserIds: [],
      };
    }

    await db.roomUser.deleteMany({
      where: {
        roomId,
        userId: {
          in: memberIds,
        },
      },
    });

    return {
      ok: true,
      removedUserIds: memberIds,
    };
  }

  async roomSettingsUpdate(state: SocketState, payloadRaw: any): Promise<ApiError | ApiOk<{
    roomId: number;
    dialogId: number;
    kind: 'group' | 'game' | 'comment';
    title: string | null;
    visibility: 'public' | 'private';
    commentsEnabled: boolean;
    avatarUrl: string | null;
    postOnlyByAdmin: boolean;
    createdById: number | null;
    pinnedNodeId: number | null;
    roomSurface: RoomSurfacePayload;
    discussion: DiscussionPayload | null;
  }>> {
    const authError = this.ctx.requireAuth(state);
    if (authError) return authError;

    const roomId = this.ctx.parseRoomId(payloadRaw?.roomId);
    if (!roomId) {
      return {ok: false, error: 'invalid_room'};
    }

    const room = await getRoomById(roomId);
    if (!room || !userCanAccessRoom(state.user!.id, room)) {
      return {ok: false, error: 'forbidden'};
    }
    if (room.kind === 'direct') {
      return {ok: false, error: 'forbidden'};
    }
    if (!userIsRoomAdmin(state.user!.id, room)) {
      return {ok: false, error: 'forbidden'};
    }

    const updateData: Record<string, unknown> = {};
    if (Object.prototype.hasOwnProperty.call(payloadRaw || {}, 'title')) {
      const title = String(payloadRaw?.title || '').trim();
      updateData.title = title ? title.slice(0, 120) : 'Комната';
    }
    if (Object.prototype.hasOwnProperty.call(payloadRaw || {}, 'visibility')) {
      updateData.visibility = normalizeRoomVisibility(payloadRaw?.visibility);
    }
    if (Object.prototype.hasOwnProperty.call(payloadRaw || {}, 'commentsEnabled')) {
      updateData.commentsEnabled = !!payloadRaw?.commentsEnabled;
    }
    if (Object.prototype.hasOwnProperty.call(payloadRaw || {}, 'avatarPath')) {
      const avatarPath = this.ctx.parseRoomAvatarPath(payloadRaw?.avatarPath);
      if (!avatarPath.ok) {
        return {ok: false, error: avatarPath.error};
      }
      updateData.avatarPath = avatarPath.value ?? null;
    }
    if (Object.prototype.hasOwnProperty.call(payloadRaw || {}, 'postOnlyByAdmin')) {
      updateData.postOnlyByAdmin = !!payloadRaw?.postOnlyByAdmin;
    }
    if (!Object.keys(updateData).length) {
      return {ok: false, error: 'invalid_input'};
    }

    await db.room.update({
      where: {
        id: roomId,
      },
      data: updateData,
    });

    const updatedRoom = await getRoomById(roomId);
    if (!updatedRoom) {
      return {ok: false, error: 'room_not_found'};
    }

    return {
      ok: true,
      roomId,
      dialogId: roomId,
      kind: updatedRoom.kind === 'game' ? 'game' : (updatedRoom.kind === 'comment' ? 'comment' : 'group'),
      title: updatedRoom.title,
      visibility: updatedRoom.visibility,
      commentsEnabled: updatedRoom.comments_enabled,
      avatarUrl: this.ctx.toRoomAvatarUrl(updatedRoom.avatar_path),
      postOnlyByAdmin: !!updatedRoom.post_only_by_admin,
      createdById: updatedRoom.created_by,
      pinnedNodeId: updatedRoom.pinned_node_id,
      roomSurface: this.toRoomSurfacePayload(updatedRoom, null, null, updatedRoom.pinned_node_id),
      discussion: await this.loadDiscussionPayload(roomId, updatedRoom.kind),
    };
  }

  async roomSurfaceSet(
    _state: SocketState,
    _roomIdRaw: unknown,
    _payloadRaw: any,
  ): Promise<ApiError | ApiOk<{
    roomId: number;
    dialogId: number;
    kind: 'group' | 'game' | 'comment';
    createdById: number | null;
    roomSurface: RoomSurfacePayload;
    roomRuntime: any | null;
    pinnedNodeId: number | null;
    pinnedMessage: any | null;
  }>> {
    return {ok: false, error: 'scriptable_disabled'};
  }

  async roomDelete(state: SocketState, roomIdRaw: unknown, optionsRaw?: any): Promise<ApiError | ApiOk<{
    changed: boolean;
    roomId: number;
    dialogId: number;
    kind: 'group' | 'direct' | 'game' | 'comment';
  }>> {
    const authError = this.ctx.requireAuth(state);
    if (authError) return authError;

    const roomId = this.ctx.parseRoomId(roomIdRaw);
    if (!roomId) {
      return {ok: false, error: 'invalid_room'};
    }

    const room = await getRoomById(roomId);
    if (!room) {
      return {ok: false, error: 'room_not_found'};
    }

    if (!userCanAccessRoom(state.user!.id, room)) {
      return {ok: false, error: 'forbidden'};
    }

    const hasConfirm = optionsRaw === true || !!optionsRaw?.confirm;
    if (!hasConfirm) {
      return {ok: false, error: 'confirm_required'};
    }

    if (room.kind !== 'direct' && !userIsRoomAdmin(state.user!.id, room)) {
      return {ok: false, error: 'forbidden'};
    }

    const uploadNames = await this.ctx.collectUploadNamesFromNodeSubtree(roomId);

    if (room.kind === 'direct') {
      const clearResult = await db.$transaction(async (tx) => {
        const pinReset = await tx.room.updateMany({
          where: {
            id: roomId,
            pinnedNodeId: {
              not: null,
            },
          },
          data: {
            pinnedNodeId: null,
          },
        });

        const deletedMessages = await tx.node.deleteMany({
          where: {
            parentId: roomId,
          },
        });

        return {
          changed: pinReset.count > 0 || deletedMessages.count > 0,
        };
      });

      if (clearResult.changed) {
        await this.ctx.cleanupUnusedUploads(uploadNames);
      }

      return {
        ok: true,
        changed: clearResult.changed,
        roomId,
        dialogId: roomId,
        kind: room.kind,
      };
    }

    const result = await db.node.deleteMany({
      where: {id: roomId},
    });
    if (result.count > 0) {
      await this.ctx.cleanupUnusedUploads(uploadNames);
      if (state.roomId === roomId) {
        state.roomId = null;
      }
    }

    return {
      ok: true,
      changed: result.count > 0,
      roomId,
      dialogId: roomId,
      kind: room.kind,
    };
  }
}
