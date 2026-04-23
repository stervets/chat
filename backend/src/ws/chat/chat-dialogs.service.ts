import {db} from '../../db.js';
import {
  createPublicGroupRoom,
  ensureUserInRoom,
  getRoomById,
  getOrCreateDirectRoom,
  getOrCreateGroupRoom,
  userCanAccessRoom,
  userIsRoomAdmin,
  type RoomSurfaceType,
  type RoomRow,
} from '../../common/rooms.js';
import {
  hasNodeRuntime,
  cloneJson,
  mergeNodeData,
  normalizeRoomSurfaceType,
  readNodeRuntime,
  readRoomSurface,
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
  enabled: boolean;
  type: RoomSurfaceType | null;
  config: Record<string, any>;
  pinnedNodeId: number | null;
  pinnedKind: 'text' | 'system' | 'scriptable' | null;
  hasRoomRuntime: boolean;
  requiresRoomRuntime: boolean;
};

type DiscussionPayload = {
  sourceMessageId: number | null;
  sourceRoomId: number | null;
  sourceRoomKind: 'group' | 'direct' | 'game' | 'comment' | null;
  sourceRoomTitle: string | null;
  sourceMessagePreview: string;
  sourceMessageDeleted: boolean;
};

function normalizeAppConfig(raw: unknown) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  return cloneJson(raw as Record<string, any>);
}

export class ChatDialogsService {
  constructor(private readonly ctx: ChatContext) {}

  private buildDiscussionPreview(rawTextRaw: unknown) {
    const preview = String(rawTextRaw || '').replace(/\s+/g, ' ').trim();
    if (!preview) return '(пусто)';
    if (preview.length <= 220) return preview;
    return `${preview.slice(0, 217)}...`;
  }

  private hasRoomRuntime(roomRuntime: RoomRuntimeRow | null) {
    if (!roomRuntime) return false;
    return hasNodeRuntime(roomRuntime.node);
  }

  private toRoomRuntimePayload(roomId: number, roomRuntime: RoomRuntimeRow | null) {
    if (!this.hasRoomRuntime(roomRuntime)) return null;
    const runtime = readNodeRuntime(roomRuntime!.node);
    return {
      nodeType: 'room',
      nodeId: roomId,
      roomId,
      clientScript: runtime.clientScript,
      serverScript: runtime.serverScript,
      data: runtime.data,
    };
  }

  private toRoomSurfacePayload(
    room: RoomRow,
    roomRuntime: RoomRuntimeRow | null,
    pinnedMessage: any | null,
    pinnedNodeIdRaw?: unknown,
  ): RoomSurfacePayload {
    const roomSurface = readRoomSurface({data: room.data || {}});
    const enabled = room.kind !== 'direct' && !!roomSurface.enabled;
    const type = enabled ? (normalizeRoomSurfaceType(roomSurface.type) || 'custom') : null;
    const config = normalizeAppConfig(roomSurface.config);
    const pinnedNodeId = room.kind === 'direct'
      ? null
      : (Number(pinnedMessage?.id || pinnedNodeIdRaw || room.pinned_node_id || 0) || null);
    const pinnedKindRaw = pinnedMessage && typeof pinnedMessage === 'object'
      ? String(pinnedMessage.kind || '').trim().toLowerCase()
      : '';
    const pinnedKind = pinnedKindRaw === 'text' || pinnedKindRaw === 'system' || pinnedKindRaw === 'scriptable'
      ? pinnedKindRaw
      : null;

    return {
      enabled,
      type,
      config,
      pinnedNodeId,
      pinnedKind,
      hasRoomRuntime: this.hasRoomRuntime(roomRuntime),
      requiresRoomRuntime: enabled && !!config.requireRoomRuntime,
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
        },
      })
      : null;

    return {
      sourceMessageId,
      sourceRoomId,
      sourceRoomKind: (sourceRoom?.kind as DiscussionPayload['sourceRoomKind']) || null,
      sourceRoomTitle: sourceRoom?.title || null,
      sourceMessagePreview: this.buildDiscussionPreview(sourceMessage.rawText),
      sourceMessageDeleted: false,
    };
  }

  async dialogsGeneral(state: SocketState): Promise<ApiError | {
    roomId: number;
    dialogId: number;
    type: 'group';
    title: string;
    createdById: number | null;
    pinnedNodeId: number | null;
    roomSurface: RoomSurfacePayload;
  }> {
    const authError = this.ctx.requireAuth(state);
    if (authError) return authError;

    const room = await getOrCreateGroupRoom(state.user!.id);
    await ensureUserInRoom(room.id, state.user!.id);
    const roomRuntime = await this.loadRoomRuntime(room.id);
    return {
      roomId: room.id,
      dialogId: room.id,
      type: 'group',
      title: room.title || 'Общий чат',
      createdById: room.created_by || null,
      pinnedNodeId: room.pinned_node_id || null,
      roomSurface: this.toRoomSurfacePayload(room, roomRuntime, null, roomRuntime?.pinnedNodeId),
    };
  }

  async dialogsPrivate(state: SocketState, userIdRaw: unknown): Promise<ApiError | {
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
      select: {
        id: true,
        nickname: true,
        name: true,
        nicknameColor: true,
        donationBadgeUntil: true,
      },
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

  async dialogsDirects(state: SocketState): Promise<ApiError | Array<{
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
              select: {
                id: true,
                nickname: true,
                name: true,
                nicknameColor: true,
                donationBadgeUntil: true,
              },
            },
          },
        },
      },
    });

    const mapped = (await Promise.all(rows.map(async (row) => {
      const targetMember = row.roomUsers.find((member) => member.userId !== userId);
      const targetUser = targetMember?.user;
      if (!targetUser) return null;

      const lastMessage = await db.message.findFirst({
        where: {
          node: {
            parentId: row.id,
          },
        },
        orderBy: [
          {createdAt: 'desc'},
          {id: 'desc'},
        ],
        select: {
          createdAt: true,
        },
      });

      return {
        roomId: row.id,
        dialogId: row.id,
        lastMessageAt: lastMessage?.createdAt.toISOString() || new Date(0).toISOString(),
        targetUser: this.ctx.toPublicUser(targetUser),
        createdById: null,
        pinnedNodeId: null,
        roomSurface: this.toRoomSurfacePayload({
          id: row.id,
          kind: 'direct',
          title: row.title || null,
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
    }))).filter(Boolean) as Array<{
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
      select: {
        id: true,
        nickname: true,
        name: true,
        nicknameColor: true,
        donationBadgeUntil: true,
      },
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

  async dialogsMessages(
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

    const renderContext = await this.ctx.buildRoomMessageRenderContext(
      roomId,
      result.map((row) => String(row.rawText || '')),
    );

    const ordered = result.reverse().map((row) => {
      const isScriptable = row.kind === 'scriptable';
      const compiled = isScriptable
        ? {
          rawText: String(row.rawText || ''),
          renderedHtml: String(row.renderedHtml || ''),
          renderedPreviews: [],
        }
        : this.ctx.compileMessageWithContext(
          String(row.rawText || ''),
          renderContext,
          row.id,
        );
      const author = this.ctx.toMessageAuthor({
        senderId: row.senderId,
        sender: row.sender,
      });

      const runtime = readNodeRuntime(row.node);
      return {
        id: row.id,
        roomId,
        dialogId: roomId,
        kind: row.kind || 'text',
        authorId: author.authorId,
        authorNickname: author.authorNickname,
        authorName: author.authorName,
        authorNicknameColor: author.authorNicknameColor,
        authorDonationBadgeUntil: author.authorDonationBadgeUntil,
        rawText: compiled.rawText,
        renderedHtml: compiled.renderedHtml,
        renderedPreviews: compiled.renderedPreviews,
        runtime,
        commentRoomId: discussionByMessageId.get(row.id) || null,
        createdAt: row.createdAt.toISOString(),
      };
    });

    return this.ctx.attachMessageReactions(ordered);
  }

  async chatJoin(state: SocketState, roomIdRaw: unknown): Promise<ApiError | ApiOk<{
    roomId: number;
    dialogId: number;
    kind: 'group' | 'direct' | 'game' | 'comment';
    createdById: number | null;
    roomRuntime: any | null;
    roomSurface: RoomSurfacePayload;
    discussion: DiscussionPayload | null;
    pinnedNodeId: number | null;
    pinnedMessage: any | null;
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

    const roomRuntime = await this.loadRoomRuntime(roomId);

    state.roomId = roomId;
    const pinnedAllowed = room.kind !== 'direct';
    const pinnedNodeId = pinnedAllowed
      ? Number(roomRuntime?.pinnedNodeId || 0)
      : 0;
    const pinnedMessage = pinnedNodeId > 0
      ? await this.ctx.loadMessagePayloadById(roomId, pinnedNodeId)
      : null;
    const discussion = await this.loadDiscussionPayload(roomId, room.kind);

    return {
      ok: true,
      roomId,
      dialogId: roomId,
      kind: room.kind,
      createdById: room.created_by || null,
      roomSurface: this.toRoomSurfacePayload(
        room,
        roomRuntime,
        pinnedAllowed ? pinnedMessage : null,
        roomRuntime?.pinnedNodeId,
      ),
      discussion,
      pinnedNodeId: pinnedAllowed
        ? (pinnedMessage?.id || (roomRuntime?.pinnedNodeId || null))
        : null,
      pinnedMessage: pinnedAllowed ? pinnedMessage : null,
      roomRuntime: this.toRoomRuntimePayload(roomId, roomRuntime),
    };
  }

  async roomsCreate(state: SocketState, payloadRaw: any): Promise<ApiError | ApiOk<{
    roomId: number;
    dialogId: number;
    kind: 'group';
    title: string;
    createdById: number;
    pinnedNodeId: null;
    roomSurface: RoomSurfacePayload;
  }>> {
    const authError = this.ctx.requireAuth(state);
    if (authError) return authError;

    const payload = payloadRaw && typeof payloadRaw === 'object' ? payloadRaw : {};
    const room = await createPublicGroupRoom(state.user!.id, payload?.title);

    return {
      ok: true,
      roomId: room.id,
      dialogId: room.id,
      kind: 'group',
      title: room.title || 'Комната',
      createdById: Number(room.created_by || state.user!.id),
      pinnedNodeId: null,
      roomSurface: this.toRoomSurfacePayload(room, null, null),
    };
  }

  async roomsSurfaceConfigure(
    state: SocketState,
    roomIdRaw: unknown,
    payloadRaw: any,
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
    if (room.kind === 'direct') {
      return {ok: false, error: 'room_surface_not_supported'};
    }
    if (!userIsRoomAdmin(state.user!.id, room)) {
      return {ok: false, error: 'forbidden'};
    }

    const payload = payloadRaw && typeof payloadRaw === 'object'
      ? payloadRaw
      : {};
    const hasEnabled = Object.prototype.hasOwnProperty.call(payload, 'enabled');
    const enabled = hasEnabled ? !!payload.enabled : true;

    const hasType = Object.prototype.hasOwnProperty.call(payload, 'type');
    const parsedType = normalizeRoomSurfaceType(payload.type);
    if (hasType && !parsedType && enabled) {
      return {ok: false, error: 'invalid_surface_type'};
    }

    const currentRoomSurface = readRoomSurface({data: room.data || {}});
    const hasConfig = Object.prototype.hasOwnProperty.call(payload, 'config');
    const rawConfig = hasConfig
      ? normalizeAppConfig(payload.config)
      : normalizeAppConfig(currentRoomSurface.config);
    const nextConfig = enabled
      ? {
        ...rawConfig,
      }
      : {};

    if (Object.prototype.hasOwnProperty.call(payload, 'requireRoomRuntime')) {
      if (enabled) {
        nextConfig.requireRoomRuntime = !!payload.requireRoomRuntime;
      } else {
        delete nextConfig.requireRoomRuntime;
      }
    }

    const hasPinnedNodeId = Object.prototype.hasOwnProperty.call(payload, 'pinnedNodeId');
    let nextPinnedNodeId = room.pinned_node_id;

    if (hasPinnedNodeId) {
      const pinnedRaw = payload.pinnedNodeId;
      if (pinnedRaw === null || pinnedRaw === undefined || pinnedRaw === '' || Number(pinnedRaw) === 0) {
        nextPinnedNodeId = null;
      } else {
        const parsed = Number.parseInt(String(pinnedRaw), 10);
        if (!Number.isFinite(parsed) || parsed <= 0) {
          return {ok: false, error: 'invalid_message'};
        }
        nextPinnedNodeId = parsed;
      }
    }

    let pinnedMessageForValidation: {
      id: number;
      kind: 'text' | 'system' | 'scriptable';
      node: {
        parentId: number | null;
      };
    } | null = null;
    if (Number(nextPinnedNodeId || 0) > 0) {
      pinnedMessageForValidation = await db.message.findUnique({
        where: {
          id: Number(nextPinnedNodeId || 0),
        },
        select: {
          id: true,
          kind: true,
          node: {
            select: {
              parentId: true,
            },
          },
        },
      }) as typeof pinnedMessageForValidation;
      if (!pinnedMessageForValidation) {
        return {ok: false, error: 'message_not_found'};
      }
      if (Number(pinnedMessageForValidation.node?.parentId || 0) !== roomId) {
        return {ok: false, error: 'message_not_in_room'};
      }
      if (enabled && pinnedMessageForValidation.kind !== 'scriptable') {
        return {ok: false, error: 'room_surface_must_be_scriptable'};
      }
    }

    const nextSurfaceType = enabled
      ? (parsedType || normalizeRoomSurfaceType(currentRoomSurface.type) || 'custom')
      : null;
    const roomRuntimeBefore = await this.loadRoomRuntime(roomId);
    const requiresRoomRuntime = enabled && !!nextConfig.requireRoomRuntime;
    if (requiresRoomRuntime && !this.hasRoomRuntime(roomRuntimeBefore)) {
      return {ok: false, error: 'room_runtime_required'};
    }

    await db.node.update({
      where: {
        id: roomId,
      },
      data: {
        data: mergeNodeData({
          current: room.data || {},
          roomSurface: {
            enabled,
            type: nextSurfaceType,
            config: enabled ? cloneJson(nextConfig) : {},
          },
        }),
      },
    });

    if (hasPinnedNodeId) {
      await db.room.update({
        where: {
          id: roomId,
        },
        data: {
          pinnedNodeId: nextPinnedNodeId,
        },
      });
    }

    const updatedRoom = await getRoomById(roomId);
    if (!updatedRoom) {
      return {ok: false, error: 'room_not_found'};
    }

    const roomRuntime = await this.loadRoomRuntime(roomId);
    const pinnedNodeId = Number(roomRuntime?.pinnedNodeId || 0);
    const pinnedMessage = pinnedNodeId > 0
      ? await this.ctx.loadMessagePayloadById(roomId, pinnedNodeId)
      : null;

    return {
      ok: true,
      roomId,
      dialogId: roomId,
      kind: updatedRoom.kind === 'game' ? 'game' : (updatedRoom.kind === 'comment' ? 'comment' : 'group'),
      createdById: updatedRoom.created_by || null,
      roomSurface: this.toRoomSurfacePayload(
        updatedRoom,
        roomRuntime,
        pinnedMessage,
        pinnedNodeId || null,
      ),
      roomRuntime: this.toRoomRuntimePayload(roomId, roomRuntime),
      pinnedNodeId: pinnedMessage?.id || (pinnedNodeId > 0 ? pinnedNodeId : null),
      pinnedMessage,
    };
  }

  async dialogsDelete(state: SocketState, roomIdRaw: unknown, optionsRaw?: any): Promise<ApiError | ApiOk<{
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

    const uploadRows = await db.message.findMany({
      where: {
        node: {
          parentId: roomId,
        },
      },
      select: {
        rawText: true,
      },
    });
    const uploadNames = uploadRows.flatMap((row) => this.ctx.extractUploadNamesFromRawText(row.rawText || ''));

    const result = await db.node.deleteMany({
      where: {id: roomId},
    });
    if (result.count > 0) {
      await this.ctx.cleanupUnusedUploads(uploadNames);
    }
    if (state.roomId === roomId) {
      state.roomId = null;
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
