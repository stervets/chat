import {db} from '../../db.js';
import {
  getDialogById,
  getOrCreateGeneralDialog,
  getOrCreatePrivateDialog,
  userCanAccessDialog,
} from '../../common/dialogs.js';
import {DEFAULT_NICKNAME_COLOR} from '../../common/const.js';
import {
  ChatContext,
  SYSTEM_NICKNAME,
  type ApiError,
  type ApiOk,
  type PublicUser,
} from './chat-context.js';
import type {SocketState} from '../protocol.js';

export class ChatDialogsService {
  constructor(private readonly ctx: ChatContext) {}

  async dialogsGeneral(state: SocketState): Promise<ApiError | {
    dialogId: number;
    type: 'general';
    title: string;
  }> {
    const authError = this.ctx.requireAuth(state);
    if (authError) return authError;

    const dialog = await getOrCreateGeneralDialog();
    return {
      dialogId: dialog.id,
      type: 'general',
      title: 'Общий чат',
    };
  }

  async dialogsPrivate(state: SocketState, userIdRaw: unknown): Promise<ApiError | {
    dialogId: number;
    type: 'private';
    targetUser: PublicUser;
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

    const dialog = await getOrCreatePrivateDialog(state.user!.id, userId);
    return {
      dialogId: dialog.id,
      type: 'private',
      targetUser: this.ctx.toPublicUser(targetUser),
    };
  }

  async dialogsDirects(state: SocketState): Promise<ApiError | Array<{
    dialogId: number;
    targetUser: PublicUser;
    lastMessageAt: string;
  }>> {
    const authError = this.ctx.requireAuth(state);
    if (authError) return authError;

    await this.ctx.pruneExpiredMessages();
    const cutoffDate = this.ctx.messagesCutoffDate();
    const userId = state.user!.id;

    const rows = await db.dialog.findMany({
      where: {
        kind: 'private',
        OR: [
          {memberAId: userId},
          {memberBId: userId},
        ],
        messages: {
          some: {
            createdAt: {
              gte: cutoffDate,
            },
          },
        },
      },
      include: {
        memberA: {
          select: {
            id: true,
            nickname: true,
            name: true,
            nicknameColor: true,
            donationBadgeUntil: true,
          },
        },
        memberB: {
          select: {
            id: true,
            nickname: true,
            name: true,
            nicknameColor: true,
            donationBadgeUntil: true,
          },
        },
        messages: {
          where: {
            createdAt: {
              gte: cutoffDate,
            },
          },
          orderBy: [
            {createdAt: 'desc'},
            {id: 'desc'},
          ],
          take: 1,
          select: {
            createdAt: true,
          },
        },
      },
    });

    const mapped = rows
      .map((row) => {
        const targetUser = row.memberAId === userId ? row.memberB : row.memberA;
        const lastMessage = row.messages[0];
        if (!targetUser || !lastMessage) return null;

        return {
          dialogId: row.id,
          lastMessageAt: lastMessage.createdAt.toISOString(),
          targetUser: this.ctx.toPublicUser(targetUser),
        };
      })
      .filter(Boolean) as Array<{
      dialogId: number;
      targetUser: PublicUser;
      lastMessageAt: string;
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
      const systemDialog = await getOrCreatePrivateDialog(userId, systemUser.id);
      const alreadyPresent = mapped.some((item) => item.dialogId === systemDialog.id);
      if (!alreadyPresent) {
        mapped.push({
          dialogId: systemDialog.id,
          targetUser: this.ctx.toPublicUser(systemUser),
          lastMessageAt: new Date(0).toISOString(),
        });
      }
    }

    mapped.sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt));
    return mapped;
  }

  async dialogsMessages(
    state: SocketState,
    dialogIdRaw: unknown,
    limitRaw?: unknown,
    beforeMessageIdRaw?: unknown,
  ): Promise<ApiError | any[]> {
    const authError = this.ctx.requireAuth(state);
    if (authError) return authError;
    await this.ctx.pruneExpiredMessages();

    const dialogId = this.ctx.parseDialogId(dialogIdRaw);
    if (!dialogId) {
      return {ok: false, error: 'invalid_dialog'};
    }

    const dialog = await getDialogById(dialogId);
    if (!dialog) {
      return {ok: false, error: 'dialog_not_found'};
    }

    if (!userCanAccessDialog(state.user!.id, dialog)) {
      return {ok: false, error: 'forbidden'};
    }

    await this.ctx.pruneDialogOverflow(dialogId);
    const limit = this.ctx.parseLimit(limitRaw);
    const cutoffDate = this.ctx.messagesCutoffDate();
    const beforeMessageId = this.ctx.parseBeforeMessageId(beforeMessageIdRaw);

    const result = await db.message.findMany({
      where: {
        dialogId,
        createdAt: {
          gte: cutoffDate,
        },
        ...(beforeMessageId ? {id: {lt: beforeMessageId}} : {}),
      },
      orderBy: [
        {createdAt: 'desc'},
        {id: 'desc'},
      ],
      take: limit,
      include: {
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

    const renderContext = await this.ctx.buildDialogMessageRenderContext(
      dialogId,
      result.map((row) => String(row.rawText || '')),
    );

    const ordered = result.reverse().map((row) => {
      const compiled = this.ctx.compileMessageWithContext(
        String(row.rawText || ''),
        renderContext,
        row.id,
      );

      return {
        id: row.id,
        dialogId: row.dialogId,
        authorId: row.sender?.id || row.senderId || 0,
        authorNickname: row.sender?.nickname || 'deleted',
        authorName: row.sender?.name || row.sender?.nickname || 'deleted',
        authorNicknameColor: row.sender?.nicknameColor || DEFAULT_NICKNAME_COLOR,
        authorDonationBadgeUntil: this.ctx.normalizeDonationBadgeUntil(row.sender?.donationBadgeUntil || null),
        rawText: compiled.rawText,
        renderedHtml: compiled.renderedHtml,
        renderedPreviews: compiled.renderedPreviews,
        createdAt: row.createdAt.toISOString(),
      };
    });

    return this.ctx.attachMessageReactions(ordered);
  }

  async chatJoin(state: SocketState, dialogIdRaw: unknown): Promise<ApiError | ApiOk<{dialogId: number}>> {
    const authError = this.ctx.requireAuth(state);
    if (authError) return authError;

    const dialogId = this.ctx.parseDialogId(dialogIdRaw);
    if (!dialogId) {
      return {ok: false, error: 'invalid_dialog'};
    }

    const dialog = await getDialogById(dialogId);
    if (!dialog) {
      return {ok: false, error: 'dialog_not_found'};
    }

    if (!userCanAccessDialog(state.user!.id, dialog)) {
      return {ok: false, error: 'forbidden'};
    }

    state.dialogId = dialogId;
    return {ok: true, dialogId};
  }

  async dialogsDelete(state: SocketState, dialogIdRaw: unknown): Promise<ApiError | ApiOk<{
    changed: boolean;
    dialogId: number;
    kind: 'private';
  }>> {
    const authError = this.ctx.requireAuth(state);
    if (authError) return authError;

    const dialogId = this.ctx.parseDialogId(dialogIdRaw);
    if (!dialogId) {
      return {ok: false, error: 'invalid_dialog'};
    }

    const dialog = await getDialogById(dialogId);
    if (!dialog) {
      return {ok: false, error: 'dialog_not_found'};
    }

    if (dialog.kind !== 'private') {
      return {ok: false, error: 'invalid_dialog'};
    }

    if (!userCanAccessDialog(state.user!.id, dialog)) {
      return {ok: false, error: 'forbidden'};
    }

    const systemUserId = await this.ctx.findSystemUserId();
    if (systemUserId && (dialog.member_a === systemUserId || dialog.member_b === systemUserId)) {
      return {ok: false, error: 'system_dialog_locked'};
    }

    const uploadRows = await db.message.findMany({
      where: {dialogId},
      select: {
        rawText: true,
      },
    });
    const uploadNames = uploadRows.flatMap((row) => this.ctx.extractUploadNamesFromRawText(row.rawText || ''));

    const result = await db.dialog.deleteMany({
      where: {id: dialogId},
    });
    if (result.count > 0) {
      await this.ctx.cleanupUnusedUploads(uploadNames);
    }
    if (state.dialogId === dialogId) {
      state.dialogId = null;
    }

    return {
      ok: true,
      changed: result.count > 0,
      dialogId,
      kind: 'private',
    };
  }
}
