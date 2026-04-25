import {db} from '../../db.js';
import {DEFAULT_NICKNAME_COLOR} from '../../common/const.js';
import {
  compileMessageFormat,
  extractMessageFormatTokens,
  type CompileMessageFormatOptions,
} from '../../common/message-format.js';
import {findCommentRoomNodeIdByMessageId} from '../../common/nodes.js';
import type {ChatContextUsers} from './chat-context.users.js';
import {
  ANONYMOUS_AUTHOR_NICKNAME,
  TAIL_TIME_SCAN_BATCH,
  type ChatContextMessagePayload,
  type MessageReaction,
  type MessageReactionUser,
  type RoomMessageRenderContext,
  type TimeRefCandidate,
} from './chat-context.types.js';

export class ChatContextMessages {
  constructor(private readonly users: ChatContextUsers) {}

  formatUsername(nicknameRaw: unknown) {
    const nickname = String(nicknameRaw || '').trim();
    if (!nickname) return '@deleted';
    return `@${nickname}`;
  }

  formatMessageTime(createdAtRaw: Date | string | null | undefined) {
    if (!createdAtRaw) return '00:00:00';
    const date = createdAtRaw instanceof Date
      ? createdAtRaw
      : new Date(String(createdAtRaw));
    if (Number.isNaN(date.getTime())) return '00:00:00';

    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    return `${hours}:${minutes}:${seconds}`;
  }

  buildTimeReferenceTooltip(rawTextRaw: unknown, authorNicknameRaw: unknown) {
    const rawText = String(rawTextRaw || '');
    const normalized = rawText.replace(/\s+/g, ' ').trim();
    const preview = normalized.length > 100 ? `${normalized.slice(0, 97)}...` : normalized;
    return `${this.formatUsername(authorNicknameRaw)}: ${preview || '(пусто)'}`;
  }

  private async loadLatestTimeCandidatesByLabel(roomId: number, timeLabels: Set<string>) {
    const unresolved = new Set(Array.from(timeLabels));
    const byLabel = new Map<string, TimeRefCandidate[]>();
    let beforeMessageId: number | null = null;

    while (unresolved.size > 0) {
      const timelineRows = await db.message.findMany({
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
        take: TAIL_TIME_SCAN_BATCH,
        select: {
          id: true,
          rawText: true,
          createdAt: true,
          sender: {
            select: {
              nickname: true,
            },
          },
        },
      });

      if (!timelineRows.length) break;

      for (const row of timelineRows) {
        const timeLabel = this.formatMessageTime(row.createdAt);
        if (!unresolved.has(timeLabel)) continue;

        byLabel.set(timeLabel, [{
          id: row.id,
          index: 0,
          tooltip: this.buildTimeReferenceTooltip(
            row.rawText,
            row.sender?.nickname || ANONYMOUS_AUTHOR_NICKNAME,
          ),
        }]);
        unresolved.delete(timeLabel);
        if (unresolved.size <= 0) break;
      }

      if (timelineRows.length < TAIL_TIME_SCAN_BATCH) break;
      beforeMessageId = timelineRows[timelineRows.length - 1]?.id || null;
      if (!beforeMessageId) break;
    }

    return byLabel;
  }

  async buildRoomMessageRenderContext(
    roomId: number,
    rawTexts: string[],
    options?: {
      useTailTimeCandidates?: boolean;
    },
  ) {
    const mentionNicknames = new Set<string>();
    const timeLabels = new Set<string>();

    rawTexts.forEach((rawText) => {
      const tokens = extractMessageFormatTokens(rawText);
      tokens.mentionNicknames.forEach((nickname) => mentionNicknames.add(nickname));
      tokens.timeLabels.forEach((timeLabel) => timeLabels.add(timeLabel));
    });

    const mentionsByToken = new Map<string, {
      nickname: string;
      name: string;
      nicknameColor: string | null;
    }>();

    if (mentionNicknames.size > 0) {
      const mentionTokens = Array.from(mentionNicknames)
        .map((value) => String(value || '').trim().toLowerCase())
        .filter((value) => !!value && value !== 'all');
      const uniqueTokens = Array.from(new Set(mentionTokens));

      if (uniqueTokens.length > 0) {
        const roomMembers = await db.roomUser.findMany({
          where: {
            roomId,
          },
          select: {
            user: {
              select: {
                nickname: true,
                name: true,
                nicknameColor: true,
              },
            },
          },
        });

        const members = roomMembers
          .map((row) => row.user)
          .filter(Boolean)
          .map((user) => ({
            nickname: String(user.nickname || '').trim(),
            name: String(user.name || user.nickname || '').trim(),
            nicknameColor: user.nicknameColor || DEFAULT_NICKNAME_COLOR,
          }))
          .filter((user) => !!user.nickname);

        const membersByNickname = new Map<string, typeof members[number]>();
        const membersByName = new Map<string, Array<typeof members[number]>>();

        members.forEach((member) => {
          const nicknameToken = member.nickname.toLowerCase();
          if (nicknameToken) {
            membersByNickname.set(nicknameToken, member);
          }

          const nameToken = member.name.toLowerCase();
          if (!nameToken) return;
          const bucket = membersByName.get(nameToken) || [];
          bucket.push(member);
          membersByName.set(nameToken, bucket);
        });

        uniqueTokens.forEach((token) => {
          const byNickname = membersByNickname.get(token);
          if (byNickname) {
            mentionsByToken.set(token, byNickname);
            return;
          }

          const byName = membersByName.get(token) || [];
          if (byName.length === 1) {
            mentionsByToken.set(token, byName[0]);
          }
        });
      }
    }

    const timeCandidatesByLabel = new Map<string, TimeRefCandidate[]>();
    const messageIndexById = new Map<number, number>();
    let timelineSize = 0;

    if (timeLabels.size > 0) {
      if (options?.useTailTimeCandidates) {
        const tailCandidates = await this.loadLatestTimeCandidatesByLabel(roomId, timeLabels);
        tailCandidates.forEach((candidates, timeLabel) => {
          timeCandidatesByLabel.set(timeLabel, candidates);
        });
      } else {
        const timelineRows = await db.message.findMany({
          where: {
            node: {
              parentId: roomId,
            },
          },
          orderBy: [
            {createdAt: 'asc'},
            {id: 'asc'},
          ],
          select: {
            id: true,
            rawText: true,
            createdAt: true,
            sender: {
              select: {
                nickname: true,
              },
            },
          },
        });

        timelineSize = timelineRows.length;

        timelineRows.forEach((row, index) => {
          messageIndexById.set(row.id, index);

          const timeLabel = this.formatMessageTime(row.createdAt);
          if (!timeLabels.has(timeLabel)) return;

          const tooltip = this.buildTimeReferenceTooltip(
            row.rawText,
            row.sender?.nickname || ANONYMOUS_AUTHOR_NICKNAME,
          );
          const candidates = timeCandidatesByLabel.get(timeLabel) || [];
          candidates.push({
            id: row.id,
            index,
            tooltip,
          });
          timeCandidatesByLabel.set(timeLabel, candidates);
        });
      }
    }

    const context: RoomMessageRenderContext = {
      mentionsByToken,
      timeCandidatesByLabel,
      messageIndexById,
      timelineSize,
    };

    return context;
  }

  buildCompileMessageOptions(context: RoomMessageRenderContext, sourceMessageId: number | null) {
    const sourceIndex = sourceMessageId && context.messageIndexById.has(sourceMessageId)
      ? Number(context.messageIndexById.get(sourceMessageId))
      : Number(context.timelineSize || 0);

    const options: CompileMessageFormatOptions = {
      resolveMention: (nicknameRaw: string) => {
        const nickname = String(nicknameRaw || '').trim().toLowerCase();
        if (!nickname) return null;
        return context.mentionsByToken.get(nickname) || null;
      },
      resolveTimeReference: (timeLabelRaw: string) => {
        const timeLabel = String(timeLabelRaw || '').trim();
        if (!timeLabel) return null;

        const candidates = context.timeCandidatesByLabel.get(timeLabel) || [];
        if (!candidates.length) return null;

        let bestCandidate = candidates[0];
        let bestDistance = Math.abs(bestCandidate.index - sourceIndex);

        for (const candidate of candidates) {
          const distance = Math.abs(candidate.index - sourceIndex);
          if (distance > bestDistance) continue;
          if (distance === bestDistance && candidate.id < bestCandidate.id) continue;
          bestCandidate = candidate;
          bestDistance = distance;
        }

        return {
          messageId: bestCandidate.id,
          tooltip: bestCandidate.tooltip,
        };
      },
    };

    return options;
  }

  compileMessageWithContext(rawText: string, context: RoomMessageRenderContext, sourceMessageId: number | null) {
    return compileMessageFormat(
      rawText,
      this.buildCompileMessageOptions(context, sourceMessageId),
    );
  }

  async compileMessageForRoom(roomId: number, rawText: string, sourceMessageId: number | null = null) {
    const context = await this.buildRoomMessageRenderContext(roomId, [rawText], {
      useTailTimeCandidates: sourceMessageId === null,
    });
    return this.compileMessageWithContext(rawText, context, sourceMessageId);
  }

  getDisabledScriptableFallbackText(rawTextRaw: unknown) {
    const rawText = String(rawTextRaw || '').trim();
    return rawText || '[scriptable disabled]';
  }

  async loadMessagePayloadById(roomId: number, messageId: number): Promise<ChatContextMessagePayload | null> {
    const messageRow = await db.message.findFirst({
      where: {
        id: messageId,
        node: {
          parentId: roomId,
        },
      },
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
            component: true,
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

    if (!messageRow) return null;

    const commentRoomId = await findCommentRoomNodeIdByMessageId(messageRow.id);
    let commentCount = 0;
    if (commentRoomId) {
      commentCount = await db.message.count({
        where: {
          node: {
            parentId: commentRoomId,
          },
        },
      });
    }
    const isScriptable = messageRow.kind === 'scriptable';
    const compiled = isScriptable
      ? await this.compileMessageForRoom(
        roomId,
        this.getDisabledScriptableFallbackText(messageRow.rawText),
        messageRow.id,
      )
      : await this.compileMessageForRoom(roomId, String(messageRow.rawText || ''), messageRow.id);

    const author = this.users.toMessageAuthor({
      senderId: messageRow.senderId,
      sender: messageRow.sender,
    });

    return {
      id: messageRow.id,
      roomId,
      dialogId: roomId,
      kind: messageRow.kind === 'system' ? 'system' : 'text',
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
      commentRoomId,
      commentCount,
      createdAt: messageRow.createdAt.toISOString(),
      reactions: await this.loadMessageReactions(messageRow.id),
    };
  }

  async loadMessageReactions(messageId: number): Promise<MessageReaction[]> {
    const rows = await db.messageReaction.findMany({
      where: {messageId},
      orderBy: {createdAt: 'asc'},
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
    });

    const grouped = new Map<string, MessageReactionUser[]>();
    for (const row of rows) {
      const users = grouped.get(row.reaction) || [];
      users.push({
        id: row.user.id,
        nickname: row.user.nickname,
        name: row.user.name?.trim() ? row.user.name.trim() : row.user.nickname,
        nicknameColor: row.user.nicknameColor || DEFAULT_NICKNAME_COLOR,
        donationBadgeUntil: this.users.normalizeDonationBadgeUntil(row.user.donationBadgeUntil),
      });
      grouped.set(row.reaction, users);
    }

    return Array.from(grouped.entries()).map(([emoji, users]) => ({emoji, users}));
  }

  async attachMessageReactions(messages: any[]) {
    if (!messages.length) return messages;

    const messageIds = messages.map((message) => Number(message.id)).filter((id) => Number.isFinite(id));
    if (!messageIds.length) {
      return messages.map((message) => ({...message, reactions: []}));
    }

    const rows = await db.messageReaction.findMany({
      where: {
        messageId: {
          in: messageIds,
        },
      },
      orderBy: {createdAt: 'asc'},
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
    });

    const byMessage = new Map<number, Map<string, MessageReactionUser[]>>();
    for (const row of rows) {
      let byEmoji = byMessage.get(row.messageId);
      if (!byEmoji) {
        byEmoji = new Map();
        byMessage.set(row.messageId, byEmoji);
      }

      const users = byEmoji.get(row.reaction) || [];
      users.push({
        id: row.user.id,
        nickname: row.user.nickname,
        name: row.user.name?.trim() ? row.user.name.trim() : row.user.nickname,
        nicknameColor: row.user.nicknameColor || DEFAULT_NICKNAME_COLOR,
        donationBadgeUntil: this.users.normalizeDonationBadgeUntil(row.user.donationBadgeUntil),
      });
      byEmoji.set(row.reaction, users);
    }

    return messages.map((message) => {
      const byEmoji = byMessage.get(Number(message.id));
      const reactions = byEmoji
        ? Array.from(byEmoji.entries()).map(([emoji, users]) => ({emoji, users}))
        : [];
      return {
        ...message,
        reactions,
      };
    });
  }
}
