import {db} from '../../db.js';
import {getRoomById, userCanAccessRoom} from '../../common/rooms.js';
import {createMessageNode, createRoomNode} from '../../common/nodes.js';
import {DEFAULT_NICKNAME_COLOR} from '../../common/const.js';
import {getGameModule} from '../../modules-runtime/registry.js';
import {bindKingBotCast, type KingRuntimeBotProfile} from '../../modules/king/bot-cast.js';
import {
  formatScoreboard,
  pickDramaticBotLine,
  pickRoundFinishedBotLine,
  roundTitle,
  shouldBotReply,
} from '../../modules/king/templates.js';
import {getRoundConfig} from '../../modules/king/rounds.js';
import {
  ChatContext,
  type ApiError,
  type ApiOk,
  type ChatContextMessagePayload,
} from './chat-context.js';
import type {SocketState} from '../protocol.js';
import type {ModuleAction, ModuleEvent, ModulePlayer} from '../../modules-runtime/types.js';
import type {KingGameState, KingModuleEvent} from '../../modules/king/types.js';

const SOLO_BOTS_COUNT = 3;
const MAX_BOT_MESSAGES_PER_ROUND = 5;
const MAX_BOT_MESSAGES_IN_ROW = 2;

type SessionWithRelations = {
  id: number;
  roomId: number;
  moduleKey: string;
  status: 'lobby' | 'active' | 'finished' | 'cancelled';
  visibility: 'solo' | 'public' | 'invite_only';
  createdById: number | null;
  createdAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
  settingsJson: any;
  stateJson: any;
  room: {
    id: number;
    kind: 'group' | 'direct' | 'game';
    roomUsers: Array<{userId: number}>;
  };
  players: Array<{
    sessionId: number;
    userId: number;
    seat: number;
    kind: 'human' | 'bot';
    joinedAt: Date;
    isReady: boolean;
    user: {
      id: number;
      nickname: string;
      name: string;
      info: string | null;
      isBot: boolean;
      nicknameColor: string | null;
      donationBadgeUntil: Date | null;
    };
  }>;
};

export class ChatGamesService {
  constructor(private readonly ctx: ChatContext) {}

  private parseSessionId(raw: unknown) {
    const sessionId = Number.parseInt(String(raw ?? ''), 10);
    if (!Number.isFinite(sessionId) || sessionId <= 0) return null;
    return sessionId;
  }

  private normalizeAction(raw: unknown): ModuleAction | null {
    const type = String((raw as any)?.type || '').trim();
    if (!type) return null;
    return {
      type,
      payload: (raw as any)?.payload,
    };
  }

  private async loadSession(sessionId: number): Promise<SessionWithRelations | null> {
    const row = await db.gameSession.findUnique({
      where: {id: sessionId},
      include: {
        room: {
          select: {
            id: true,
            kind: true,
            roomUsers: {
              select: {userId: true},
            },
          },
        },
        players: {
          orderBy: {seat: 'asc'},
          include: {
            user: {
              select: {
                id: true,
                nickname: true,
                name: true,
                info: true,
                isBot: true,
                nicknameColor: true,
                donationBadgeUntil: true,
              },
            },
          },
        },
      },
    });

    return row as SessionWithRelations | null;
  }

  private async ensureSystemSenderId() {
    return this.ctx.findSystemUserId();
  }

  private toMessagePayload(input: {
    roomId: number;
    kind: 'text' | 'system';
    author: {
      id: number;
      nickname: string;
      name: string;
      nicknameColor: string | null;
      donationBadgeUntil: Date | null;
    };
    message: {
      id: number;
      createdAt: Date;
      rawText: string;
      renderedHtml: string;
      renderedPreviews: any[];
    };
  }): ChatContextMessagePayload {
    return {
      id: input.message.id,
      roomId: input.roomId,
      dialogId: input.roomId,
      kind: input.kind,
      authorId: input.author.id,
      authorNickname: input.author.nickname,
      authorName: input.author.name || input.author.nickname,
      authorNicknameColor: input.author.nicknameColor || DEFAULT_NICKNAME_COLOR,
      authorDonationBadgeUntil: this.ctx.normalizeDonationBadgeUntil(input.author.donationBadgeUntil),
      rawText: input.message.rawText,
      renderedHtml: input.message.renderedHtml,
      renderedPreviews: input.message.renderedPreviews,
      scriptId: null,
      scriptRevision: 0,
      scriptMode: null,
      scriptConfigJson: {},
      scriptStateJson: {},
      createdAt: input.message.createdAt.toISOString(),
      reactions: [],
    };
  }

  private async createRoomMessage(input: {
    roomId: number;
    senderId: number;
    rawText: string;
    kind?: 'text' | 'system';
  }): Promise<ChatContextMessagePayload | null> {
    const sender = await db.user.findUnique({
      where: {id: input.senderId},
      select: {
        id: true,
        nickname: true,
        name: true,
        nicknameColor: true,
        donationBadgeUntil: true,
      },
    });

    if (!sender) return null;

    const compiled = await this.ctx.compileMessageForRoom(input.roomId, input.rawText);
    const created = await createMessageNode(db, {
      roomId: input.roomId,
      senderId: sender.id,
      createdById: sender.id,
      kind: input.kind || 'text',
      rawText: compiled.rawText,
      renderedHtml: compiled.renderedHtml,
    });

    return this.toMessagePayload({
      roomId: input.roomId,
      author: sender,
      message: {
        id: created.message.id,
        createdAt: created.message.createdAt,
        rawText: compiled.rawText,
        renderedHtml: compiled.renderedHtml,
        renderedPreviews: compiled.renderedPreviews,
      },
      kind: input.kind || 'text',
    });
  }

  private async createSystemMessage(roomId: number, text: string) {
    const senderId = await this.ensureSystemSenderId();
    if (!senderId) return null;
    return this.createRoomMessage({
      roomId,
      senderId,
      rawText: text,
      kind: 'system',
    });
  }

  private buildSessionPayload(session: SessionWithRelations, forUserId: number) {
    const gameModule = getGameModule(session.moduleKey);
    if (!gameModule) {
      throw new Error('module_disabled');
    }

    const state = gameModule.getPublicState({
      state: session.stateJson,
      forUserId,
    });

    const actions = gameModule.listActions({
      state: session.stateJson,
      forUserId,
    });

    return {
      id: session.id,
      roomId: session.roomId,
      moduleKey: session.moduleKey,
      status: session.status,
      visibility: session.visibility,
      createdById: session.createdById,
      createdAt: session.createdAt.toISOString(),
      startedAt: session.startedAt ? session.startedAt.toISOString() : null,
      finishedAt: session.finishedAt ? session.finishedAt.toISOString() : null,
      players: session.players.map((player) => ({
        userId: player.userId,
        seat: player.seat,
        kind: player.kind,
        joinedAt: player.joinedAt.toISOString(),
        isReady: player.isReady,
        user: {
          id: player.user.id,
          nickname: player.user.nickname,
          name: player.user.name,
          nicknameColor: player.user.nicknameColor || DEFAULT_NICKNAME_COLOR,
          donationBadgeUntil: this.ctx.normalizeDonationBadgeUntil(player.user.donationBadgeUntil),
          isBot: player.user.isBot,
          info: player.user.info,
        },
      })),
      state,
      actions,
    };
  }

  private async createBotAndSystemMessages(input: {
    roomId: number;
    state: KingGameState;
    events: KingModuleEvent[];
    botCast: KingRuntimeBotProfile[];
  }) {
    const output: ChatContextMessagePayload[] = [];

    for (const event of input.events) {
      if (event.type === 'king:round_started') {
        const roundKind = String((event.payload as any)?.roundKind || input.state.roundKind);
        const roundIndex = Number((event.payload as any)?.roundIndex ?? input.state.roundIndex);
        const title = String((event.payload as any)?.roundTitle || getRoundConfig(roundIndex)?.title || roundKind);
        const message = await this.createSystemMessage(input.roomId, roundTitle(roundIndex, title));
        if (message) {
          output.push(message);
          input.state.chat.consecutiveBotMessages = 0;
        }
        continue;
      }

      if (event.type === 'king:round_finished') {
        const message = await this.createSystemMessage(
          input.roomId,
          `Раунд ${input.state.roundResults.length} завершён. Счёт: ${formatScoreboard(input.state)}`,
        );
        if (message) {
          output.push(message);
          input.state.chat.consecutiveBotMessages = 0;
        }
      }

      if (event.type === 'king:match_finished') {
        const message = await this.createSystemMessage(
          input.roomId,
          `Матч завершён. Финальный счёт: ${formatScoreboard(input.state)}`,
        );
        if (message) {
          output.push(message);
          input.state.chat.consecutiveBotMessages = 0;
        }
      }

      const dramaticEvent = event.type === 'king:round_finished'
        || event.type === 'king:king_taken'
        || event.type === 'king:last_trick_taken';

      if (!dramaticEvent) continue;
      if (input.state.chat.roundBotMessages >= MAX_BOT_MESSAGES_PER_ROUND) continue;
      if (input.state.chat.consecutiveBotMessages >= MAX_BOT_MESSAGES_IN_ROW) continue;

      const candidates = [...input.botCast].sort((left, right) => left.userId - right.userId);
      let selected: KingRuntimeBotProfile | null = null;
      for (const bot of candidates) {
        if (!shouldBotReply({bot, state: input.state, event})) continue;
        selected = bot;
        break;
      }

      if (!selected) continue;

      const line = event.type === 'king:round_finished'
        ? pickRoundFinishedBotLine({bot: selected, state: input.state})
        : pickDramaticBotLine({bot: selected, state: input.state, event});

      if (!line) continue;

      const botMessage = await this.createRoomMessage({
        roomId: input.roomId,
        senderId: selected.userId,
        rawText: line,
      });

      if (!botMessage) continue;

      output.push(botMessage);
      input.state.chat.roundBotMessages += 1;
      input.state.chat.consecutiveBotMessages += 1;
      input.state.chat.lastSpeakerUserId = selected.userId;
    }

    return output;
  }

  async gamesSoloCreate(state: SocketState, payloadRaw: any): Promise<ApiError | ApiOk<{
    roomId: number;
    sessionId: number;
    session: any;
    messages: ChatContextMessagePayload[];
    events: ModuleEvent[];
  }>> {
    const authError = this.ctx.requireAuth(state);
    if (authError) return authError;

    const moduleKey = String(payloadRaw?.moduleKey || 'king').trim().toLowerCase();
    if (moduleKey !== 'king') {
      return {ok: false, error: 'unsupported_module'};
    }

    const gameModule = getGameModule(moduleKey);
    if (!gameModule) {
      return {ok: false, error: 'module_disabled'};
    }

    const availableBots = await db.user.findMany({
      where: {
        isBot: true,
      },
      orderBy: {
        id: 'asc',
      },
      select: {
        id: true,
      },
    });

    if (availableBots.length < SOLO_BOTS_COUNT) {
      return {ok: false, error: 'not_enough_bots'};
    }

    const selectedBots = availableBots.slice(0, SOLO_BOTS_COUNT);
    const botCast = bindKingBotCast(selectedBots);
    if (botCast.length < SOLO_BOTS_COUNT) {
      return {ok: false, error: 'bot_cast_unavailable'};
    }

    const players: ModulePlayer[] = [
      {
        userId: state.user!.id,
        seat: 0,
        kind: 'human',
      },
      ...botCast.slice(0, SOLO_BOTS_COUNT).map((bot, index) => ({
        userId: bot.userId,
        seat: index + 1,
        kind: 'bot' as const,
      })),
    ];

    const created = await db.$transaction(async (tx) => {
      const room = await createRoomNode(tx, {
        kind: 'game',
        title: 'King · solo',
        createdById: state.user!.id,
        nodeData: {},
      });

      await tx.roomUser.createMany({
        data: players.map((player) => ({
          roomId: room.room.id,
          userId: player.userId,
        })),
        skipDuplicates: true,
      });

      const session = await tx.gameSession.create({
        data: {
          roomId: room.room.id,
          moduleKey,
          status: 'active',
          visibility: 'solo',
          createdById: state.user!.id,
          startedAt: new Date(),
          settingsJson: {
            mode: 'solo',
            seats: 4,
          },
          stateJson: {},
        },
        select: {
          id: true,
          roomId: true,
        },
      });

      await tx.gameSessionPlayer.createMany({
        data: players.map((player) => ({
          sessionId: session.id,
          userId: player.userId,
          seat: player.seat,
          kind: player.kind,
          isReady: true,
        })),
        skipDuplicates: true,
      });

      const botBehaviorByUserId: Record<string, any> = {};
      for (const bot of botCast) {
        botBehaviorByUserId[String(bot.userId)] = bot.behavior;
      }

      const initialState = gameModule.createInitialState({
        sessionId: session.id,
        players,
        settings: {
          mode: 'solo',
          botBehaviorByUserId,
        },
      });

      await tx.gameSession.update({
        where: {id: session.id},
        data: {
          stateJson: initialState as any,
        },
      });

      return {
        roomId: room.room.id,
        sessionId: session.id,
      };
    });

    const createdSession = await this.loadSession(created.sessionId);
    if (!createdSession) {
      return {ok: false, error: 'session_not_found'};
    }

    const messages: ChatContextMessagePayload[] = [];
    const matchCreatedMessage = await this.createSystemMessage(
      created.roomId,
      'Матч King создан: solo (ты + 3 бота).',
    );
    if (matchCreatedMessage) {
      messages.push(matchCreatedMessage);
    }

    const roundConfig = getRoundConfig(0);
    if (roundConfig) {
      const roundMessage = await this.createSystemMessage(
        created.roomId,
        roundTitle(0, roundConfig.title),
      );
      if (roundMessage) {
        messages.push(roundMessage);
      }
    }

    await this.ctx.pruneRoomOverflow(created.roomId);

    const sessionPayload = this.buildSessionPayload(createdSession, state.user!.id);

    state.roomId = created.roomId;

    return {
      ok: true,
      roomId: created.roomId,
      sessionId: created.sessionId,
      session: sessionPayload,
      messages,
      events: [
        {
          type: 'king:round_started',
          payload: {
            roundIndex: 0,
            roundKind: (createdSession.stateJson as KingGameState).roundKind,
          },
        },
      ],
    };
  }

  async gamesSessionGet(state: SocketState, sessionIdRaw: unknown): Promise<ApiError | ApiOk<{
    roomId: number;
    sessionId: number;
    session: any;
  }>> {
    const authError = this.ctx.requireAuth(state);
    if (authError) return authError;

    const sessionId = this.parseSessionId(sessionIdRaw);
    if (!sessionId) {
      return {ok: false, error: 'invalid_session'};
    }

    const session = await this.loadSession(sessionId);
    if (!session) {
      return {ok: false, error: 'session_not_found'};
    }

    const room = await getRoomById(session.roomId);
    if (!room) {
      return {ok: false, error: 'room_not_found'};
    }

    if (!userCanAccessRoom(state.user!.id, room)) {
      return {ok: false, error: 'forbidden'};
    }

    const payload = this.buildSessionPayload(session, state.user!.id);
    state.roomId = session.roomId;

    return {
      ok: true,
      roomId: session.roomId,
      sessionId,
      session: payload,
    };
  }

  async gamesAction(state: SocketState, payloadRaw: any): Promise<ApiError | ApiOk<{
    roomId: number;
    sessionId: number;
    session: any;
    events: ModuleEvent[];
    messages: ChatContextMessagePayload[];
  }>> {
    const authError = this.ctx.requireAuth(state);
    if (authError) return authError;

    const sessionId = this.parseSessionId(payloadRaw?.sessionId);
    if (!sessionId) {
      return {ok: false, error: 'invalid_session'};
    }

    const action = this.normalizeAction(payloadRaw?.action);
    if (!action) {
      return {ok: false, error: 'invalid_action'};
    }

    const session = await this.loadSession(sessionId);
    if (!session) {
      return {ok: false, error: 'session_not_found'};
    }

    if (session.status !== 'active') {
      return {ok: false, error: 'session_not_active'};
    }

    const room = await getRoomById(session.roomId);
    if (!room || !userCanAccessRoom(state.user!.id, room)) {
      return {ok: false, error: 'forbidden'};
    }

    const actor = session.players.find((player) => player.userId === state.user!.id);
    if (!actor) {
      return {ok: false, error: 'forbidden'};
    }

    const gameModule = getGameModule(session.moduleKey);
    if (!gameModule) {
      return {ok: false, error: 'module_disabled'};
    }

    const nowIso = new Date().toISOString();
    let nextState = structuredClone(session.stateJson) as KingGameState;
    const events: ModuleEvent[] = [];

    try {
      const firstStep = gameModule.applyAction({
        state: nextState,
        actorUserId: state.user!.id,
        action,
        nowIso,
      });
      nextState = firstStep.nextState as KingGameState;
      events.push(...firstStep.events);
    } catch (error: any) {
      const message = String(error?.message || error || 'invalid_action');
      if (message.includes('not_your_turn')) {
        return {ok: false, error: 'not_your_turn'};
      }
      if (message.includes('invalid_card') || message.includes('card_not_in_hand')) {
        return {ok: false, error: 'invalid_card'};
      }
      if (message.includes('game_not_playing')) {
        return {ok: false, error: 'session_not_active'};
      }
      return {ok: false, error: 'invalid_action'};
    }

    const botProfiles = bindKingBotCast(
      session.players
        .filter((player) => player.kind === 'bot')
        .map((player) => ({id: player.userId})),
    );

    let botGuard = 0;
    while (nextState.phase === 'playing' && botGuard < 48) {
      botGuard += 1;

      const currentPlayer = session.players.find((player) => player.seat === nextState.currentSeat);
      if (!currentPlayer || currentPlayer.kind !== 'bot') {
        break;
      }

      if (!gameModule.runBotTurn) break;

      const botAction = await gameModule.runBotTurn({
        state: nextState,
        actorUserId: currentPlayer.userId,
        nowIso,
      });

      const step = gameModule.applyAction({
        state: nextState,
        actorUserId: currentPlayer.userId,
        action: botAction,
        nowIso,
      });

      nextState = step.nextState as KingGameState;
      events.push(...step.events);
    }

    const nextStatus = nextState.phase === 'finished' ? 'finished' : 'active';
    const finishedAt = nextStatus === 'finished' ? new Date() : null;

    await db.gameSession.update({
      where: {id: sessionId},
      data: {
        stateJson: nextState as any,
        status: nextStatus,
        finishedAt,
      },
    });

    const messages = await this.createBotAndSystemMessages({
      roomId: session.roomId,
      state: nextState,
      events: events as KingModuleEvent[],
      botCast: botProfiles,
    });

    await this.ctx.pruneRoomOverflow(session.roomId);

    const updatedSession = await this.loadSession(sessionId);
    if (!updatedSession) {
      return {ok: false, error: 'session_not_found'};
    }

    const sessionPayload = this.buildSessionPayload(updatedSession, state.user!.id);
    state.roomId = session.roomId;

    return {
      ok: true,
      roomId: session.roomId,
      sessionId,
      session: sessionPayload,
      events,
      messages,
    };
  }
}
