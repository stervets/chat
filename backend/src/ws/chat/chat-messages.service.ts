import {db} from '../../db.js';
import {ensureUserInRoom, getRoomById, userCanAccessRoom, userIsRoomAdmin} from '../../common/rooms.js';
import {createMessageNode, createRoomNode} from '../../common/nodes.js';
import {
  ANONYMOUS_AUTHOR_ID,
  ANONYMOUS_AUTHOR_NAME,
  ANONYMOUS_AUTHOR_NICKNAME,
  ChatContext,
  MAX_MESSAGE_LENGTH,
  type ApiError,
  type ApiOk,
  type ChatContextMessagePayload,
} from './chat-context.js';
import type {SocketState} from '../protocol.js';

export class ChatMessagesService {
  constructor(private readonly ctx: ChatContext) {}

  private parseMessageId(raw: unknown) {
    const messageId = Number.parseInt(String(raw ?? ''), 10);
    if (!Number.isFinite(messageId) || messageId <= 0) return null;
    return messageId;
  }

  private buildDiscussionRoomTitle(messageId: number, rawTextRaw: unknown) {
    const base = `Комментарии к сообщению #${messageId}`;
    const preview = String(rawTextRaw || '').replace(/\s+/g, ' ').trim();
    if (!preview) return base;
    const suffix = preview.length > 56
      ? `${preview.slice(0, 53)}...`
      : preview;
    const title = `${base}: ${suffix}`;
    return title.length > 120 ? title.slice(0, 120) : title;
  }

  private parseMessageCreateOptions(raw: unknown) {
    const options = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
    return {
      anonymous: !!options.anonymous,
    };
  }

  private async buildCommentNotifyPayload(roomId: number, commentMessageId: number, actorUserId: number) {
    const commentRoom = await db.room.findUnique({
      where: {
        id: roomId,
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
    const sourceMessageId = Number(commentRoom?.node?.parentId || 0);
    if (!Number.isFinite(sourceMessageId) || sourceMessageId <= 0) return null;

    const sourceMessage = await db.message.findUnique({
      where: {
        id: sourceMessageId,
      },
      select: {
        id: true,
        senderId: true,
        rawText: true,
        createdAt: true,
        node: {
          select: {
            parentId: true,
          },
        },
      },
    });
    const targetUserId = Number(sourceMessage?.senderId || 0);
    if (!Number.isFinite(targetUserId) || targetUserId <= 0 || targetUserId === actorUserId) return null;

    const commentMessage = await this.ctx.loadMessagePayloadById(roomId, commentMessageId);
    if (!commentMessage) return null;

    return {
      userId: targetUserId,
      roomId,
      roomKind: 'comment' as const,
      messageId: commentMessage.id,
      sourceMessageId: sourceMessage.id,
      sourceRoomId: Number(sourceMessage.node?.parentId || 0) || null,
      sourceMessagePreview: this.buildDiscussionRoomTitle(sourceMessage.id, sourceMessage.rawText),
      actor: {
        id: commentMessage.authorId,
        nickname: commentMessage.authorNickname,
        name: commentMessage.authorName,
        avatarUrl: commentMessage.authorAvatarUrl || null,
        nicknameColor: commentMessage.authorNicknameColor,
        donationBadgeUntil: commentMessage.authorDonationBadgeUntil || null,
      },
      messageBody: commentMessage.rawText,
      createdAt: commentMessage.createdAt,
    };
  }

  async messageCreate(state: SocketState, roomIdRaw: unknown, bodyRaw: unknown, optionsRaw?: unknown): Promise<ApiError | ApiOk<{
    message: ChatContextMessagePayload;
    notifyComment: null | {
      userId: number;
      roomId: number;
      roomKind: 'comment';
      messageId: number;
      sourceMessageId: number;
      sourceRoomId: number | null;
      sourceMessagePreview: string;
      actor: {
        id: number;
        nickname: string;
        name: string;
        avatarUrl: string | null;
        nicknameColor: string | null;
        donationBadgeUntil: string | null;
      };
      messageBody: string;
      createdAt: string;
    };
  }>> {
    const authError = this.ctx.requireAuth(state);
    if (authError) return authError;
    const options = this.parseMessageCreateOptions(optionsRaw);

    const roomId = this.ctx.parseRoomId(roomIdRaw);
    if (!roomId) {
      return {ok: false, error: 'invalid_room'};
    }

    const room = await getRoomById(roomId);
    if (!room || !userCanAccessRoom(state.user!.id, room)) {
      return {ok: false, error: 'forbidden'};
    }
    if (room.post_only_by_admin && !userIsRoomAdmin(state.user!.id, room)) {
      return {ok: false, error: 'room_posting_restricted'};
    }
    if ((room.kind === 'group' || room.kind === 'game') && room.visibility === 'public') {
      await ensureUserInRoom(room.id, state.user!.id);
    }

    const trimmed = String(bodyRaw ?? '').trim();
    if (!trimmed) {
      return {ok: false, error: 'empty_message'};
    }

    const rawText = trimmed.length > MAX_MESSAGE_LENGTH
      ? trimmed.slice(0, MAX_MESSAGE_LENGTH)
      : trimmed;
    const compiled = await this.ctx.compileMessageForRoom(roomId, rawText);
    const anonymous = options.anonymous;
    const senderId = anonymous ? null : state.user!.id;

    const created = await createMessageNode(db, {
      roomId,
      senderId,
      createdById: senderId,
      kind: 'text',
      rawText: compiled.rawText,
      renderedHtml: compiled.renderedHtml,
    });

    await this.ctx.pruneRoomOverflow(roomId);

    const message = await this.ctx.loadMessagePayloadById(roomId, created.message.id);
    if (!message) {
      return {ok: false, error: 'message_not_found'};
    }

    return {
      ok: true,
      message,
      notifyComment: room.kind === 'comment'
        ? await this.buildCommentNotifyPayload(roomId, message.id, state.user!.id)
        : null,
    };
  }

  async messageUpdate(state: SocketState, messageIdRaw: unknown, bodyRaw: unknown): Promise<ApiError | ApiOk<{
    changed: boolean;
    message: ChatContextMessagePayload;
  }>> {
    const authError = this.ctx.requireAuth(state);
    if (authError) return authError;
    const messageId = this.parseMessageId(messageIdRaw);
    if (!messageId) {
      return {ok: false, error: 'invalid_message'};
    }

    const existing = await db.message.findUnique({
      where: {id: messageId},
      select: {
        id: true,
        senderId: true,
        kind: true,
        rawText: true,
        renderedHtml: true,
        createdAt: true,
        node: {
          select: {
            parentId: true,
          },
        },
      },
    });

    if (!existing) {
      return {ok: false, error: 'message_not_found'};
    }

    const roomId = Number(existing.node?.parentId || 0);
    if (!Number.isFinite(roomId) || roomId <= 0) {
      return {ok: false, error: 'room_not_found'};
    }

    if (existing.senderId !== state.user!.id) {
      return {ok: false, error: 'forbidden'};
    }
    if (existing.kind !== 'text') {
      return {ok: false, error: 'message_not_editable'};
    }

    const room = await getRoomById(roomId);
    if (!room || !userCanAccessRoom(state.user!.id, room)) {
      return {ok: false, error: 'forbidden'};
    }

    const trimmed = String(bodyRaw ?? '').trim();
    if (!trimmed) {
      return {ok: false, error: 'empty_message'};
    }

    const rawText = trimmed.length > MAX_MESSAGE_LENGTH
      ? trimmed.slice(0, MAX_MESSAGE_LENGTH)
      : trimmed;
    const compiled = await this.ctx.compileMessageForRoom(roomId, rawText, existing.id);

    const changed = compiled.rawText !== (existing.rawText || '') || compiled.renderedHtml !== (existing.renderedHtml || '');
    if (changed) {
      await db.message.update({
        where: {id: messageId},
        data: {
          rawText: compiled.rawText,
          renderedHtml: compiled.renderedHtml,
        },
      });
    }

    const message = await this.ctx.loadMessagePayloadById(roomId, existing.id);
    if (!message) {
      return {ok: false, error: 'message_not_found'};
    }

    return {
      ok: true,
      changed,
      message,
    };
  }

  async messageDelete(state: SocketState, messageIdRaw: unknown): Promise<ApiError | ApiOk<{
    changed: boolean;
    roomId: number;
    dialogId: number;
    messageId: number;
    pinnedCleared: boolean;
  }>> {
    const authError = this.ctx.requireAuth(state);
    if (authError) return authError;
    const messageId = this.parseMessageId(messageIdRaw);
    if (!messageId) {
      return {ok: false, error: 'invalid_message'};
    }

    const existing = await db.message.findUnique({
      where: {id: messageId},
      select: {
        id: true,
        senderId: true,
        node: {
          select: {
            parentId: true,
          },
        },
      },
    });

    if (!existing) {
      return {ok: false, error: 'message_not_found'};
    }

    const roomId = Number(existing.node?.parentId || 0);
    if (!Number.isFinite(roomId) || roomId <= 0) {
      return {ok: false, error: 'room_not_found'};
    }

    if (existing.senderId !== state.user!.id) {
      return {ok: false, error: 'forbidden'};
    }

    const room = await getRoomById(roomId);
    if (!room || !userCanAccessRoom(state.user!.id, room)) {
      return {ok: false, error: 'forbidden'};
    }

    const uploadNames = await this.ctx.collectUploadNamesFromNodeSubtree(messageId);
    const pinnedCleared = Number(room.pinned_node_id || 0) === messageId;
    const result = await db.node.deleteMany({
      where: {id: messageId},
    });
    if (result.count > 0) {
      await this.ctx.cleanupUnusedUploads(uploadNames);
    }
    return {
      ok: true,
      changed: result.count > 0,
      roomId,
      dialogId: roomId,
      messageId,
      pinnedCleared: result.count > 0 && pinnedCleared,
    };
  }

  async messageCommentRoomGet(
    state: SocketState,
    messageIdRaw: unknown,
  ): Promise<ApiError | ApiOk<{
    messageId: number;
    commentRoomId: number | null;
  }>> {
    const authError = this.ctx.requireAuth(state);
    if (authError) return authError;

    const messageId = this.parseMessageId(messageIdRaw);
    if (!messageId) {
      return {ok: false, error: 'invalid_message'};
    }

    const message = await db.message.findUnique({
      where: {
        id: messageId,
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

    if (!message) {
      return {ok: false, error: 'message_not_found'};
    }

    const sourceRoomId = Number(message.node?.parentId || 0);
    if (!Number.isFinite(sourceRoomId) || sourceRoomId <= 0) {
      return {ok: false, error: 'room_not_found'};
    }

    const room = await getRoomById(sourceRoomId);
    if (!room || !userCanAccessRoom(state.user!.id, room)) {
      return {ok: false, error: 'forbidden'};
    }

    const discussionRoom = await db.room.findFirst({
      where: {
        kind: 'comment',
        node: {
          parentId: message.id,
        },
      },
      select: {
        id: true,
      },
    });

    return {
      ok: true,
      messageId: message.id,
      commentRoomId: Number(discussionRoom?.id || 0) || null,
    };
  }

  async messageCommentRoomCreate(
    state: SocketState,
    messageIdRaw: unknown,
  ): Promise<ApiError | ApiOk<{
    created: boolean;
    messageId: number;
    sourceRoomId: number;
    commentRoomId: number;
    message: ChatContextMessagePayload | null;
  }>> {
    const authError = this.ctx.requireAuth(state);
    if (authError) return authError;

    const messageId = this.parseMessageId(messageIdRaw);
    if (!messageId) {
      return {ok: false, error: 'invalid_message'};
    }

    const existingMessage = await db.message.findUnique({
      where: {
        id: messageId,
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

    if (!existingMessage) {
      return {ok: false, error: 'message_not_found'};
    }

    const sourceRoomId = Number(existingMessage.node?.parentId || 0);
    if (!Number.isFinite(sourceRoomId) || sourceRoomId <= 0) {
      return {ok: false, error: 'room_not_found'};
    }

    const sourceRoom = await getRoomById(sourceRoomId);
    if (!sourceRoom || !userCanAccessRoom(state.user!.id, sourceRoom)) {
      return {ok: false, error: 'forbidden'};
    }
    if (!sourceRoom.comments_enabled) {
      return {ok: false, error: 'comments_disabled'};
    }

    const existingCommentRoom = await db.room.findFirst({
      where: {
        kind: 'comment',
        node: {
          parentId: existingMessage.id,
        },
      },
      select: {
        id: true,
      },
    });

    if (existingCommentRoom) {
      return {
        ok: true,
        created: false,
        messageId: existingMessage.id,
        sourceRoomId,
        commentRoomId: existingCommentRoom.id,
        message: await this.ctx.loadMessagePayloadById(sourceRoomId, existingMessage.id),
      };
    }

    const created = await db.$transaction(async (tx) => {
      await tx.$queryRaw`select id from nodes where id = ${messageId} for update`;

      const locked = await tx.message.findUnique({
        where: {
          id: messageId,
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
      if (!locked) {
        return {ok: false, error: 'message_not_found'} as const;
      }

      const lockedSourceRoomId = Number(locked.node?.parentId || 0);
      if (!Number.isFinite(lockedSourceRoomId) || lockedSourceRoomId <= 0) {
        return {ok: false, error: 'room_not_found'} as const;
      }

      const linkedCommentRoom = await tx.room.findFirst({
        where: {
          kind: 'comment',
          node: {
            parentId: locked.id,
          },
        },
        select: {
          id: true,
        },
      });

      if (linkedCommentRoom) {
        return {
          ok: true,
          created: false,
          messageId: locked.id,
          sourceRoomId: lockedSourceRoomId,
          commentRoomId: linkedCommentRoom.id,
        } as const;
      }

      const createdRoom = await createRoomNode(tx, {
        parentId: locked.id,
        kind: 'comment',
        title: this.buildDiscussionRoomTitle(locked.id, locked.rawText),
        createdById: state.user!.id,
        nodeData: {},
      });

      const sourceMembers = await tx.roomUser.findMany({
        where: {
          roomId: lockedSourceRoomId,
        },
        select: {
          userId: true,
        },
      });

      if (sourceMembers.length > 0) {
        await tx.roomUser.createMany({
          data: sourceMembers.map((item) => ({
            roomId: createdRoom.room.id,
            userId: item.userId,
          })),
          skipDuplicates: true,
        });
      }

      return {
        ok: true,
        created: true,
        messageId: locked.id,
        sourceRoomId: lockedSourceRoomId,
        commentRoomId: createdRoom.room.id,
      } as const;
    });

    if (!(created as any)?.ok) {
      return created as any;
    }

    return {
      ...(created as any),
      message: await this.ctx.loadMessagePayloadById(
        Number((created as any).sourceRoomId || 0),
        Number((created as any).messageId || 0),
      ),
    };
  }

  async roomPinSet(state: SocketState, roomIdRaw: unknown, messageIdRaw: unknown): Promise<ApiError | ApiOk<{
    changed: boolean;
    roomId: number;
    dialogId: number;
    pinnedNodeId: number | null;
    pinnedMessage: ChatContextMessagePayload | null;
  }>> {
    const authError = this.ctx.requireAuth(state);
    if (authError) return authError;

    const roomId = this.ctx.parseRoomId(roomIdRaw);
    if (!roomId) {
      return {ok: false, error: 'invalid_room'};
    }

    const messageId = this.parseMessageId(messageIdRaw);
    if (!messageId) {
      return {ok: false, error: 'invalid_message'};
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

    const message = await db.message.findUnique({
      where: {
        id: messageId,
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
    });
    if (!message) {
      return {ok: false, error: 'message_not_found'};
    }
    if (Number(message.node?.parentId || 0) !== roomId) {
      return {ok: false, error: 'message_not_in_room'};
    }
    if (room.surface_enabled && message.kind !== 'scriptable') {
      return {ok: false, error: 'room_surface_must_be_scriptable'};
    }

    const changed = Number(room.pinned_node_id || 0) !== messageId;
    if (changed) {
      await db.room.update({
        where: {
          id: roomId,
        },
        data: {
          pinnedNodeId: messageId,
        },
      });
    }

    const pinnedMessage = await this.ctx.loadMessagePayloadById(roomId, messageId);
    return {
      ok: true,
      changed,
      roomId,
      dialogId: roomId,
      pinnedNodeId: pinnedMessage?.id || messageId,
      pinnedMessage,
    };
  }

  async roomPinClear(state: SocketState, roomIdRaw: unknown): Promise<ApiError | ApiOk<{
    changed: boolean;
    roomId: number;
    dialogId: number;
    pinnedNodeId: null;
    pinnedMessage: null;
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
    if (room.kind === 'direct') {
      return {ok: false, error: 'forbidden'};
    }
    if (!userIsRoomAdmin(state.user!.id, room)) {
      return {ok: false, error: 'forbidden'};
    }

    const changed = Number(room.pinned_node_id || 0) > 0;
    if (changed) {
      await db.room.update({
        where: {
          id: roomId,
        },
        data: {
          pinnedNodeId: null,
        },
      });
    }

    return {
      ok: true,
      changed,
      roomId,
      dialogId: roomId,
      pinnedNodeId: null,
      pinnedMessage: null,
    };
  }
}
