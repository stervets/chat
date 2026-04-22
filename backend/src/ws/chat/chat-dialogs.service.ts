import {db} from '../../db.js';
import {
  ensureUserInRoom,
  getRoomById,
  getOrCreateDirectRoom,
  getOrCreateGroupRoom,
  userCanAccessRoom,
} from '../../common/rooms.js';
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
    roomId: number;
    dialogId: number;
    type: 'group';
    title: string;
  }> {
    const authError = this.ctx.requireAuth(state);
    if (authError) return authError;

    const room = await getOrCreateGroupRoom();
    await ensureUserInRoom(room.id, state.user!.id);
    return {
      roomId: room.id,
      dialogId: room.id,
      type: 'group',
      title: room.title || 'Общий чат',
    };
  }

  async dialogsPrivate(state: SocketState, userIdRaw: unknown): Promise<ApiError | {
    roomId: number;
    dialogId: number;
    type: 'direct';
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

    const room = await getOrCreateDirectRoom(state.user!.id, userId);
    return {
      roomId: room.id,
      dialogId: room.id,
      type: 'direct',
      targetUser: this.ctx.toPublicUser(targetUser),
    };
  }

  async dialogsDirects(state: SocketState): Promise<ApiError | Array<{
    roomId: number;
    dialogId: number;
    targetUser: PublicUser;
    lastMessageAt: string;
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
        messages: {
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
        const targetMember = row.roomUsers.find((member) => member.userId !== userId);
        const targetUser = targetMember?.user;
        const lastMessage = row.messages[0];
        if (!targetUser || !lastMessage) return null;

        return {
          roomId: row.id,
          dialogId: row.id,
          lastMessageAt: lastMessage.createdAt.toISOString(),
          targetUser: this.ctx.toPublicUser(targetUser),
        };
      })
      .filter(Boolean) as Array<{
      roomId: number;
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
      const systemRoom = await getOrCreateDirectRoom(userId, systemUser.id);
      const alreadyPresent = mapped.some((item) => item.roomId === systemRoom.id);
      if (!alreadyPresent) {
        mapped.push({
          roomId: systemRoom.id,
          dialogId: systemRoom.id,
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
        roomId,
        ...(beforeMessageId ? {id: {lt: beforeMessageId}} : {}),
      },
      orderBy: [
        {createdAt: 'desc'},
        {id: 'desc'},
      ],
      take: limit,
      select: {
        id: true,
        roomId: true,
        senderId: true,
        kind: true,
        rawText: true,
        renderedHtml: true,
        createdAt: true,
        scriptId: true,
        scriptRevision: true,
        scriptMode: true,
        scriptConfigJson: true,
        scriptStateJson: true,
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

      return {
        id: row.id,
        roomId: row.roomId,
        dialogId: row.roomId,
        kind: row.kind || 'text',
        authorId: row.sender?.id || row.senderId || 0,
        authorNickname: row.sender?.nickname || 'deleted',
        authorName: row.sender?.name || row.sender?.nickname || 'deleted',
        authorNicknameColor: row.sender?.nicknameColor || DEFAULT_NICKNAME_COLOR,
        authorDonationBadgeUntil: this.ctx.normalizeDonationBadgeUntil(row.sender?.donationBadgeUntil || null),
        rawText: compiled.rawText,
        renderedHtml: compiled.renderedHtml,
        renderedPreviews: compiled.renderedPreviews,
        scriptId: row.scriptId || null,
        scriptRevision: Number(row.scriptRevision || 0),
        scriptMode: row.scriptMode || null,
        scriptConfigJson: row.scriptConfigJson || {},
        scriptStateJson: row.scriptStateJson || {},
        createdAt: row.createdAt.toISOString(),
      };
    });

    return this.ctx.attachMessageReactions(ordered);
  }

  async chatJoin(state: SocketState, roomIdRaw: unknown): Promise<ApiError | ApiOk<{roomId: number; dialogId: number; roomScript: any | null}>> {
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

    const roomScript = await db.room.findUnique({
      where: {id: roomId},
      select: {
        id: true,
        scriptId: true,
        scriptRevision: true,
        scriptMode: true,
        scriptConfigJson: true,
        scriptStateJson: true,
      },
    });

    state.roomId = roomId;
    return {
      ok: true,
      roomId,
      dialogId: roomId,
      roomScript: roomScript?.scriptId && roomScript.scriptMode && Number(roomScript.scriptRevision || 0) > 0
        ? {
          entityType: 'room',
          entityId: roomScript.id,
          roomId,
          scriptId: roomScript.scriptId,
          scriptRevision: Number(roomScript.scriptRevision || 0),
          scriptMode: roomScript.scriptMode,
          scriptConfigJson: roomScript.scriptConfigJson || {},
          scriptStateJson: roomScript.scriptStateJson || {},
        }
        : null,
    };
  }

  async dialogsDelete(state: SocketState, roomIdRaw: unknown): Promise<ApiError | ApiOk<{
    changed: boolean;
    roomId: number;
    dialogId: number;
    kind: 'direct';
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

    if (room.kind !== 'direct') {
      return {ok: false, error: 'invalid_room'};
    }

    if (!userCanAccessRoom(state.user!.id, room)) {
      return {ok: false, error: 'forbidden'};
    }

    const systemUserId = await this.ctx.findSystemUserId();
    if (systemUserId && room.member_user_ids.includes(systemUserId)) {
      return {ok: false, error: 'system_dialog_locked'};
    }

    const uploadRows = await db.message.findMany({
      where: {roomId},
      select: {
        rawText: true,
      },
    });
    const uploadNames = uploadRows.flatMap((row) => this.ctx.extractUploadNamesFromRawText(row.rawText || ''));

    const result = await db.room.deleteMany({
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
      kind: 'direct',
    };
  }
}
