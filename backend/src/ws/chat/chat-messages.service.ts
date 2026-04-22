import {db} from '../../db.js';
import {getRoomById, userCanAccessRoom, userIsRoomAdmin} from '../../common/rooms.js';
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

  private parseChatSendOptions(raw: unknown) {
    const options = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
    return {
      anonymous: !!options.anonymous,
    };
  }

  async chatSend(state: SocketState, roomIdRaw: unknown, bodyRaw: unknown, optionsRaw?: unknown): Promise<ApiError | ApiOk<{
    message: ChatContextMessagePayload;
  }>> {
    const authError = this.ctx.requireAuth(state);
    if (authError) return authError;
    const options = this.parseChatSendOptions(optionsRaw);

    const roomId = this.ctx.parseRoomId(roomIdRaw);
    if (!roomId) {
      return {ok: false, error: 'invalid_room'};
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
    const compiled = await this.ctx.compileMessageForRoom(roomId, rawText);
    const anonymous = options.anonymous;
    const senderId = anonymous ? null : state.user!.id;

    const created = await db.message.create({
      data: {
        roomId,
        senderId,
        kind: 'text',
        rawText: compiled.rawText,
        renderedHtml: compiled.renderedHtml,
      },
      select: {
        id: true,
        createdAt: true,
      },
    });
    await this.ctx.pruneRoomOverflow(roomId);

    return {
      ok: true,
      message: {
        id: created.id,
        roomId,
        dialogId: roomId,
        kind: 'text',
        authorId: anonymous ? ANONYMOUS_AUTHOR_ID : state.user!.id,
        authorNickname: anonymous ? ANONYMOUS_AUTHOR_NICKNAME : state.user!.nickname,
        authorName: anonymous ? ANONYMOUS_AUTHOR_NAME : state.user!.name,
        authorNicknameColor: anonymous ? null : state.user!.nicknameColor,
        authorDonationBadgeUntil: anonymous ? null : state.user!.donationBadgeUntil,
        rawText: compiled.rawText,
        renderedHtml: compiled.renderedHtml,
        renderedPreviews: compiled.renderedPreviews,
        scriptId: null,
        scriptRevision: 0,
        scriptMode: null,
        scriptConfigJson: {},
        scriptStateJson: {},
        discussionRoomId: null,
        createdAt: created.createdAt.toISOString(),
        reactions: [],
      },
    };
  }

  async chatEdit(state: SocketState, messageIdRaw: unknown, bodyRaw: unknown): Promise<ApiError | ApiOk<{
    changed: boolean;
    message: ChatContextMessagePayload;
  }>> {
    const authError = this.ctx.requireAuth(state);
    if (authError) return authError;
    const messageId = Number.parseInt(String(messageIdRaw ?? ''), 10);
    if (!Number.isFinite(messageId) || messageId <= 0) {
      return {ok: false, error: 'invalid_message'};
    }

    const existing = await db.message.findUnique({
      where: {id: messageId},
      select: {
        id: true,
        roomId: true,
        senderId: true,
        discussionRoomId: true,
        kind: true,
        rawText: true,
        renderedHtml: true,
        createdAt: true,
      },
    });

    if (!existing) {
      return {ok: false, error: 'message_not_found'};
    }

    if (existing.senderId !== state.user!.id) {
      return {ok: false, error: 'forbidden'};
    }
    if (existing.kind !== 'text') {
      return {ok: false, error: 'message_not_editable'};
    }

    const room = await getRoomById(existing.roomId);
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
    const compiled = await this.ctx.compileMessageForRoom(existing.roomId, rawText, existing.id);

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

    return {
      ok: true,
      changed,
      message: {
        id: existing.id,
        roomId: existing.roomId,
        dialogId: existing.roomId,
        kind: 'text',
        authorId: state.user!.id,
        authorNickname: state.user!.nickname,
        authorName: state.user!.name,
        authorNicknameColor: state.user!.nicknameColor,
        authorDonationBadgeUntil: state.user!.donationBadgeUntil,
        rawText: compiled.rawText,
        renderedHtml: compiled.renderedHtml,
        renderedPreviews: compiled.renderedPreviews,
        scriptId: null,
        scriptRevision: 0,
        scriptMode: null,
        scriptConfigJson: {},
        scriptStateJson: {},
        discussionRoomId: Number(existing.discussionRoomId || 0) || null,
        createdAt: existing.createdAt.toISOString(),
        reactions: await this.ctx.loadMessageReactions(messageId),
      },
    };
  }

  async chatDelete(state: SocketState, messageIdRaw: unknown): Promise<ApiError | ApiOk<{
    changed: boolean;
    roomId: number;
    dialogId: number;
    messageId: number;
    pinnedCleared: boolean;
  }>> {
    const authError = this.ctx.requireAuth(state);
    if (authError) return authError;
    const messageId = Number.parseInt(String(messageIdRaw ?? ''), 10);
    if (!Number.isFinite(messageId) || messageId <= 0) {
      return {ok: false, error: 'invalid_message'};
    }

    const existing = await db.message.findUnique({
      where: {id: messageId},
      select: {
        id: true,
        roomId: true,
        senderId: true,
        rawText: true,
        room: {
          select: {
            pinnedMessageId: true,
          },
        },
      },
    });

    if (!existing) {
      return {ok: false, error: 'message_not_found'};
    }

    if (existing.senderId !== state.user!.id) {
      return {ok: false, error: 'forbidden'};
    }

    const room = await getRoomById(existing.roomId);
    if (!room || !userCanAccessRoom(state.user!.id, room)) {
      return {ok: false, error: 'forbidden'};
    }

    const uploadNames = this.ctx.extractUploadNamesFromRawText(existing.rawText || '');
    const pinnedCleared = Number(existing.room?.pinnedMessageId || 0) === messageId;
    const result = await db.message.deleteMany({
      where: {id: messageId},
    });
    if (result.count > 0) {
      await this.ctx.cleanupUnusedUploads(uploadNames);
    }
    return {
      ok: true,
      changed: result.count > 0,
      roomId: existing.roomId,
      dialogId: existing.roomId,
      messageId,
      pinnedCleared: result.count > 0 && pinnedCleared,
    };
  }

  async messagesDiscussionGet(
    state: SocketState,
    messageIdRaw: unknown,
  ): Promise<ApiError | ApiOk<{
    messageId: number;
    discussionRoomId: number | null;
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
        roomId: true,
        discussionRoomId: true,
      },
    });

    if (!message) {
      return {ok: false, error: 'message_not_found'};
    }

    const room = await getRoomById(message.roomId);
    if (!room || !userCanAccessRoom(state.user!.id, room)) {
      return {ok: false, error: 'forbidden'};
    }

    return {
      ok: true,
      messageId: message.id,
      discussionRoomId: Number(message.discussionRoomId || 0) || null,
    };
  }

  async messagesDiscussionCreate(
    state: SocketState,
    messageIdRaw: unknown,
  ): Promise<ApiError | ApiOk<{
    created: boolean;
    messageId: number;
    sourceRoomId: number;
    discussionRoomId: number;
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
        roomId: true,
        rawText: true,
        discussionRoomId: true,
      },
    });

    if (!existingMessage) {
      return {ok: false, error: 'message_not_found'};
    }

    const sourceRoom = await getRoomById(existingMessage.roomId);
    if (!sourceRoom || !userCanAccessRoom(state.user!.id, sourceRoom)) {
      return {ok: false, error: 'forbidden'};
    }

    if (Number(existingMessage.discussionRoomId || 0) > 0) {
      return {
        ok: true,
        created: false,
        messageId: existingMessage.id,
        sourceRoomId: existingMessage.roomId,
        discussionRoomId: Number(existingMessage.discussionRoomId || 0),
        message: await this.ctx.loadMessagePayloadById(
          existingMessage.roomId,
          existingMessage.id,
        ),
      };
    }

    const created = await db.$transaction(async (tx) => {
      await tx.$queryRaw`select id from messages where id = ${messageId} for update`;

      const locked = await tx.message.findUnique({
        where: {
          id: messageId,
        },
        select: {
          id: true,
          roomId: true,
          rawText: true,
          discussionRoomId: true,
        },
      });
      if (!locked) {
        return {ok: false, error: 'message_not_found'} as const;
      }

      const linkedDiscussionRoomId = Number(locked.discussionRoomId || 0);
      if (linkedDiscussionRoomId > 0) {
        return {
          ok: true,
          created: false,
          messageId: locked.id,
          sourceRoomId: locked.roomId,
          discussionRoomId: linkedDiscussionRoomId,
        } as const;
      }

      const createdRoom = await tx.room.create({
        data: {
          kind: 'group',
          title: this.buildDiscussionRoomTitle(locked.id, locked.rawText),
          createdById: state.user!.id,
          appEnabled: false,
          appType: null,
          appConfigJson: {},
        },
        select: {
          id: true,
        },
      });

      const sourceMembers = await tx.roomUser.findMany({
        where: {
          roomId: locked.roomId,
        },
        select: {
          userId: true,
        },
      });

      if (sourceMembers.length > 0) {
        await tx.roomUser.createMany({
          data: sourceMembers.map((item) => ({
            roomId: createdRoom.id,
            userId: item.userId,
          })),
          skipDuplicates: true,
        });
      }

      await tx.message.update({
        where: {
          id: locked.id,
        },
        data: {
          discussionRoomId: createdRoom.id,
        },
      });

      return {
        ok: true,
        created: true,
        messageId: locked.id,
        sourceRoomId: locked.roomId,
        discussionRoomId: createdRoom.id,
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

  async chatPin(state: SocketState, roomIdRaw: unknown, messageIdRaw: unknown): Promise<ApiError | ApiOk<{
    changed: boolean;
    roomId: number;
    dialogId: number;
    pinnedMessageId: number | null;
    pinnedMessage: ChatContextMessagePayload | null;
  }>> {
    const authError = this.ctx.requireAuth(state);
    if (authError) return authError;

    const roomId = this.ctx.parseRoomId(roomIdRaw);
    if (!roomId) {
      return {ok: false, error: 'invalid_room'};
    }

    const messageId = Number.parseInt(String(messageIdRaw ?? ''), 10);
    if (!Number.isFinite(messageId) || messageId <= 0) {
      return {ok: false, error: 'invalid_message'};
    }

    const room = await getRoomById(roomId);
    if (!room || !userCanAccessRoom(state.user!.id, room)) {
      return {ok: false, error: 'forbidden'};
    }
    if (room.kind === 'direct') {
      return {ok: false, error: 'pin_not_supported'};
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
        roomId: true,
        kind: true,
      },
    });
    if (!message) {
      return {ok: false, error: 'message_not_found'};
    }
    if (message.roomId !== roomId) {
      return {ok: false, error: 'message_not_in_room'};
    }
    if (room.app_enabled && message.kind !== 'scriptable') {
      return {ok: false, error: 'app_surface_must_be_scriptable'};
    }

    const changed = Number(room.pinned_message_id || 0) !== messageId;
    if (changed) {
      await db.room.update({
        where: {
          id: roomId,
        },
        data: {
          pinnedMessageId: messageId,
        },
      });
    }

    const pinnedMessage = await this.ctx.loadMessagePayloadById(roomId, messageId);
    return {
      ok: true,
      changed,
      roomId,
      dialogId: roomId,
      pinnedMessageId: pinnedMessage?.id || messageId,
      pinnedMessage,
    };
  }

  async chatUnpin(state: SocketState, roomIdRaw: unknown): Promise<ApiError | ApiOk<{
    changed: boolean;
    roomId: number;
    dialogId: number;
    pinnedMessageId: null;
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
      return {ok: false, error: 'pin_not_supported'};
    }
    if (!userIsRoomAdmin(state.user!.id, room)) {
      return {ok: false, error: 'forbidden'};
    }

    const changed = Number(room.pinned_message_id || 0) > 0;
    if (changed) {
      await db.room.update({
        where: {
          id: roomId,
        },
        data: {
          pinnedMessageId: null,
        },
      });
    }

    return {
      ok: true,
      changed,
      roomId,
      dialogId: roomId,
      pinnedMessageId: null,
      pinnedMessage: null,
    };
  }
}
