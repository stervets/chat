import {db} from '../../db.js';
import {getDialogById, userCanAccessDialog} from '../../common/dialogs.js';
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

  async chatSend(state: SocketState, dialogIdRaw: unknown, bodyRaw: unknown): Promise<ApiError | ApiOk<{
    message: ChatContextMessagePayload;
  }>> {
    const authError = this.ctx.requireAuth(state);
    if (authError) return authError;

    const dialogId = this.ctx.parseDialogId(dialogIdRaw);
    if (!dialogId) {
      return {ok: false, error: 'invalid_dialog'};
    }

    const dialog = await getDialogById(dialogId);
    if (!dialog || !userCanAccessDialog(state.user!.id, dialog)) {
      return {ok: false, error: 'forbidden'};
    }

    const trimmed = String(bodyRaw ?? '').trim();
    if (!trimmed) {
      return {ok: false, error: 'empty_message'};
    }

    const rawText = trimmed.length > MAX_MESSAGE_LENGTH
      ? trimmed.slice(0, MAX_MESSAGE_LENGTH)
      : trimmed;
    const compiled = await this.ctx.compileMessageForDialog(dialogId, rawText);

    await this.ctx.pruneExpiredMessages();
    const created = await db.message.create({
      data: {
        dialogId,
        senderId: state.user!.id,
        rawText: compiled.rawText,
        renderedHtml: compiled.renderedHtml,
      },
      select: {
        id: true,
        createdAt: true,
      },
    });
    await this.ctx.pruneDialogOverflow(dialogId);

    return {
      ok: true,
      message: {
        id: created.id,
        dialogId,
        authorId: state.user!.id,
        authorNickname: state.user!.nickname,
        authorName: state.user!.name,
        authorNicknameColor: state.user!.nicknameColor,
        authorDonationBadgeUntil: state.user!.donationBadgeUntil,
        rawText: compiled.rawText,
        renderedHtml: compiled.renderedHtml,
        renderedPreviews: compiled.renderedPreviews,
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
    await this.ctx.pruneExpiredMessages();

    const messageId = Number.parseInt(String(messageIdRaw ?? ''), 10);
    if (!Number.isFinite(messageId) || messageId <= 0) {
      return {ok: false, error: 'invalid_message'};
    }

    const existing = await db.message.findUnique({
      where: {id: messageId},
      select: {
        id: true,
        dialogId: true,
        senderId: true,
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

    const dialog = await getDialogById(existing.dialogId);
    if (!dialog || !userCanAccessDialog(state.user!.id, dialog)) {
      return {ok: false, error: 'forbidden'};
    }

    const trimmed = String(bodyRaw ?? '').trim();
    if (!trimmed) {
      return {ok: false, error: 'empty_message'};
    }

    const rawText = trimmed.length > MAX_MESSAGE_LENGTH
      ? trimmed.slice(0, MAX_MESSAGE_LENGTH)
      : trimmed;
    const compiled = await this.ctx.compileMessageForDialog(existing.dialogId, rawText, existing.id);

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
        dialogId: existing.dialogId,
        authorId: state.user!.id,
        authorNickname: state.user!.nickname,
        authorName: state.user!.name,
        authorNicknameColor: state.user!.nicknameColor,
        authorDonationBadgeUntil: state.user!.donationBadgeUntil,
        rawText: compiled.rawText,
        renderedHtml: compiled.renderedHtml,
        renderedPreviews: compiled.renderedPreviews,
        createdAt: existing.createdAt.toISOString(),
        reactions: await this.ctx.loadMessageReactions(messageId),
      },
    };
  }

  async chatDelete(state: SocketState, messageIdRaw: unknown): Promise<ApiError | ApiOk<{
    changed: boolean;
    dialogId: number;
    messageId: number;
  }>> {
    const authError = this.ctx.requireAuth(state);
    if (authError) return authError;
    await this.ctx.pruneExpiredMessages();

    const messageId = Number.parseInt(String(messageIdRaw ?? ''), 10);
    if (!Number.isFinite(messageId) || messageId <= 0) {
      return {ok: false, error: 'invalid_message'};
    }

    const existing = await db.message.findUnique({
      where: {id: messageId},
      select: {
        id: true,
        dialogId: true,
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

    const dialog = await getDialogById(existing.dialogId);
    if (!dialog || !userCanAccessDialog(state.user!.id, dialog)) {
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
      dialogId: existing.dialogId,
      messageId,
    };
  }
}
