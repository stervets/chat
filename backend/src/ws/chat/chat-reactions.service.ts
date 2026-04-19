import {db} from '../../db.js';
import {getDialogById, userCanAccessDialog} from '../../common/dialogs.js';
import {ChatContext, type ApiError, type ApiOk, type MessageReaction, type PublicUser} from './chat-context.js';
import type {SocketState} from '../protocol.js';

export class ChatReactionsService {
  constructor(private readonly ctx: ChatContext) {}

  async chatReact(state: SocketState, messageIdRaw: unknown, reactionRaw: unknown): Promise<ApiError | ApiOk<{
    dialogId: number;
    messageId: number;
    reactions: MessageReaction[];
    changed: boolean;
    notify: null | {
      userId: number;
      dialogId: number;
      messageId: number;
      emoji: string;
      actor: PublicUser;
      messageBody: string;
      createdAt: string;
    };
  }>> {
    const authError = this.ctx.requireAuth(state);
    if (authError) return authError;

    const messageId = Number.parseInt(String(messageIdRaw ?? ''), 10);
    if (!Number.isFinite(messageId) || messageId <= 0) {
      return {ok: false, error: 'invalid_message'};
    }

    const parsedEmoji = this.ctx.parseReactionEmoji(reactionRaw);
    if (!parsedEmoji.ok) {
      return {ok: false, error: parsedEmoji.error};
    }

    const message = await db.message.findUnique({
      where: {id: messageId},
      select: {
        id: true,
        dialogId: true,
        senderId: true,
        rawText: true,
      },
    });

    if (!message) {
      return {ok: false, error: 'message_not_found'};
    }

    const dialog = await getDialogById(message.dialogId);
    if (!dialog || !userCanAccessDialog(state.user!.id, dialog)) {
      return {ok: false, error: 'forbidden'};
    }

    const existing = await db.messageReaction.findUnique({
      where: {
        messageId_userId: {
          messageId,
          userId: state.user!.id,
        },
      },
      select: {
        id: true,
        reaction: true,
      },
    });

    const now = new Date();
    let finalEmoji: string | null = parsedEmoji.value;
    let reactionSetForNotify = false;
    let changed = false;

    if (!parsedEmoji.value) {
      if (existing) {
        await db.messageReaction.delete({
          where: {id: existing.id},
        });
        changed = true;
      }
      finalEmoji = null;
    } else if (existing) {
      if (existing.reaction === parsedEmoji.value) {
        await db.messageReaction.delete({
          where: {id: existing.id},
        });
        finalEmoji = null;
        changed = true;
      } else {
        await db.messageReaction.update({
          where: {id: existing.id},
          data: {
            reaction: parsedEmoji.value,
            createdAt: now,
          },
        });
        finalEmoji = parsedEmoji.value;
        reactionSetForNotify = true;
        changed = true;
      }
    } else {
      await db.messageReaction.create({
        data: {
          messageId,
          userId: state.user!.id,
          reaction: parsedEmoji.value,
          createdAt: now,
        },
      });
      finalEmoji = parsedEmoji.value;
      reactionSetForNotify = true;
      changed = true;
    }

    const reactions = await this.ctx.loadMessageReactions(messageId);
    const shouldNotify = reactionSetForNotify
      && !!finalEmoji
      && typeof message.senderId === 'number'
      && message.senderId > 0
      && message.senderId !== state.user!.id;

    return {
      ok: true,
      dialogId: message.dialogId,
      messageId,
      reactions,
      changed,
      notify: shouldNotify
        ? {
          userId: Number(message.senderId),
          dialogId: message.dialogId,
          messageId,
          emoji: finalEmoji!,
          actor: {
            id: state.user!.id,
            nickname: state.user!.nickname,
            name: state.user!.name,
            nicknameColor: state.user!.nicknameColor,
            donationBadgeUntil: state.user!.donationBadgeUntil,
          },
          messageBody: message.rawText || '',
          createdAt: now.toISOString(),
        }
        : null,
    };
  }
}
