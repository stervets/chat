import {db} from '../../db.js';
import {getRoomById, userCanAccessRoom} from '../../common/rooms.js';
import {
  ChatContext,
  MAX_MESSAGE_LENGTH,
  type ApiError,
  type ApiOk,
  type ChatContextMessagePayload,
} from './chat-context.js';
import type {SocketState} from '../protocol.js';

export class ChatMessagesService {
  constructor(private readonly ctx: ChatContext) {}

  async chatSend(state: SocketState, roomIdRaw: unknown, bodyRaw: unknown): Promise<ApiError | ApiOk<{
    message: ChatContextMessagePayload;
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

    const trimmed = String(bodyRaw ?? '').trim();
    if (!trimmed) {
      return {ok: false, error: 'empty_message'};
    }

    const rawText = trimmed.length > MAX_MESSAGE_LENGTH
      ? trimmed.slice(0, MAX_MESSAGE_LENGTH)
      : trimmed;
    const compiled = await this.ctx.compileMessageForRoom(roomId, rawText);

    const created = await db.message.create({
      data: {
        roomId,
        senderId: state.user!.id,
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
    };
  }
}
