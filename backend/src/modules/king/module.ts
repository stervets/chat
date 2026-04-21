import type {GameModule, ModuleAction, ModuleEvent, ModulePlayer} from '../../modules-runtime/types.js';
import {pickBotCard} from './bot-strategy.js';
import {KING_ROUNDS, getRoundConfig} from './rounds.js';
import {calcTrickDelta, isLastTwoTricks, trickHasKingOfHearts} from './scoring.js';
import {
  createEmptyTrick,
  getSeatPlayer,
  getUserPlayer,
  isLegalCard,
  listLegalCards,
  nextSeat,
  pickTrickWinner,
  pushPlay,
  setupRound,
  takeCardFromHand,
} from './rules.js';
import type {
  KingCard,
  KingGameState,
  KingModuleAction,
  KingModuleEvent,
  KingPublicState,
} from './types.js';

function normalizeCard(raw: any): KingCard | null {
  const suit = String(raw?.suit || '').trim() as KingCard['suit'];
  const rank = String(raw?.rank || '').trim() as KingCard['rank'];

  if (!['clubs', 'diamonds', 'hearts', 'spades'].includes(suit)) return null;
  if (!['7', '8', '9', '10', 'J', 'Q', 'K', 'A'].includes(rank)) return null;

  return {suit, rank};
}

function cloneState(state: unknown): KingGameState {
  return structuredClone(state) as KingGameState;
}

function toAction(raw: ModuleAction): KingModuleAction | null {
  if (raw?.type !== 'play_card') return null;
  const card = normalizeCard((raw as any)?.payload);
  if (!card) return null;
  return {
    type: 'play_card',
    payload: card,
  };
}

function ensureTurn(state: KingGameState, actorUserId: number) {
  const actor = getUserPlayer(state, actorUserId);
  if (state.currentSeat !== actor.seat) {
    throw new Error('not_your_turn');
  }
  return actor;
}

function toPublicState(state: KingGameState, forUserId: number): KingPublicState {
  return {
    phase: state.phase,
    sessionId: state.sessionId,
    players: state.players
      .map((player) => {
        const isSelf = player.userId === forUserId;
        return {
          userId: player.userId,
          seat: player.seat,
          kind: player.kind,
          cardsCount: player.hand.length,
          totalScore: player.totalScore,
          roundScore: player.roundScore,
          tricksTaken: player.tricksTaken,
          hand: isSelf ? player.hand.map((card) => ({...card})) : [],
        };
      })
      .sort((left, right) => left.seat - right.seat),
    roundIndex: state.roundIndex,
    roundKind: state.roundKind,
    currentSeat: state.currentSeat,
    currentLeaderSeat: state.currentLeaderSeat,
    leadSuit: state.leadSuit,
    trumpSuit: state.trumpSuit,
    currentTrick: {
      leaderSeat: state.currentTrick.leaderSeat,
      winnerSeat: state.currentTrick.winnerSeat,
      plays: state.currentTrick.plays.map((play) => ({
        seat: play.seat,
        card: {...play.card},
      })),
    },
    completedTricksCount: state.completedTricks.length,
    roundResults: state.roundResults.map((result) => ({
      roundIndex: result.roundIndex,
      roundKind: result.roundKind,
      deltaBySeat: [...result.deltaBySeat],
    })),
    roundStarterSeat: state.roundStarterSeat,
  };
}

function buildInitialState(input: {
  sessionId: number;
  players: ModulePlayer[];
  settings: Record<string, unknown>;
}) {
  const players = [...input.players]
    .sort((left, right) => left.seat - right.seat)
    .map((player) => ({
      userId: player.userId,
      seat: player.seat,
      kind: player.kind,
      hand: [] as KingCard[],
      totalScore: 0,
      roundScore: 0,
      tricksTaken: 0,
    }));

  const botBehaviorByUserId = {
    ...((input.settings?.botBehaviorByUserId as Record<string, any>) || {}),
  };

  const state: KingGameState = {
    phase: 'dealing',
    sessionId: input.sessionId,
    players,
    roundIndex: 0,
    roundKind: KING_ROUNDS[0].kind,
    currentSeat: 0,
    currentLeaderSeat: 0,
    leadSuit: null,
    trumpSuit: null,
    currentTrick: createEmptyTrick(0),
    completedTricks: [],
    roundResults: [],
    roundStarterSeat: 0,
    chat: {
      roundBotMessages: 0,
      consecutiveBotMessages: 0,
      lastSpeakerUserId: null,
    },
    botBehaviorByUserId,
  };

  setupRound(state, 0);
  return state;
}

function applyPlayCard(state: KingGameState, actorUserId: number, action: KingModuleAction) {
  if (state.phase !== 'playing') {
    throw new Error('game_not_playing');
  }

  const actor = ensureTurn(state, actorUserId);
  const card = action.payload;

  if (!isLegalCard(state, actor.seat, card)) {
    throw new Error('invalid_card');
  }

  const removed = takeCardFromHand(actor, card);
  if (!removed) {
    throw new Error('card_not_in_hand');
  }

  const events: KingModuleEvent[] = [];
  pushPlay(state, actor.seat, card);

  events.push({
    type: 'king:card_played',
    payload: {
      seat: actor.seat,
      userId: actor.userId,
      card,
      trickSize: state.currentTrick.plays.length,
    },
  });

  if (state.currentTrick.plays.length < state.players.length) {
    state.currentSeat = nextSeat(state, actor.seat);
    return {state, events};
  }

  const winnerSeat = pickTrickWinner(state.currentTrick, state.leadSuit!, state.trumpSuit);
  state.currentTrick.winnerSeat = winnerSeat;

  const completedTrick = {
    leaderSeat: state.currentTrick.leaderSeat,
    winnerSeat,
    plays: state.currentTrick.plays.map((play) => ({
      seat: play.seat,
      card: {...play.card},
    })),
  };

  state.completedTricks.push(completedTrick);

  const winner = getSeatPlayer(state, winnerSeat);
  winner.tricksTaken += 1;

  const trickIndex = state.completedTricks.length;
  const delta = calcTrickDelta(state.roundKind, completedTrick, trickIndex);
  winner.roundScore += delta;

  events.push({
    type: 'king:trick_finished',
    payload: {
      seat: winnerSeat,
      userId: winner.userId,
      trickIndex,
      delta,
      trick: completedTrick,
    },
  });

  if (trickHasKingOfHearts(completedTrick)) {
    events.push({
      type: 'king:king_taken',
      payload: {
        seat: winnerSeat,
        userId: winner.userId,
      },
    });
  }

  if (isLastTwoTricks(trickIndex)) {
    events.push({
      type: 'king:last_trick_taken',
      payload: {
        seat: winnerSeat,
        userId: winner.userId,
        trickIndex,
      },
    });
  }

  if (trickIndex >= 8) {
    state.phase = 'round_end';

    const orderedPlayers = [...state.players].sort((left, right) => left.seat - right.seat);
    const deltaBySeat = orderedPlayers.map((player) => player.roundScore);

    for (const player of state.players) {
      player.totalScore += player.roundScore;
    }

    state.roundResults.push({
      roundIndex: state.roundIndex,
      roundKind: state.roundKind,
      deltaBySeat,
    });

    events.push({
      type: 'king:round_finished',
      payload: {
        roundIndex: state.roundIndex,
        roundKind: state.roundKind,
        deltaBySeat,
        totalBySeat: orderedPlayers.map((player) => player.totalScore),
      },
    });

    if (state.roundIndex >= KING_ROUNDS.length - 1) {
      state.phase = 'finished';
      const maxScore = Math.max(...state.players.map((player) => player.totalScore));
      const winners = state.players.filter((player) => player.totalScore === maxScore);
      events.push({
        type: 'king:match_finished',
        payload: {
          totalBySeat: orderedPlayers.map((player) => player.totalScore),
          winnerSeats: winners.map((winnerPlayer) => winnerPlayer.seat),
          winnerUserIds: winners.map((winnerPlayer) => winnerPlayer.userId),
        },
      });
      return {state, events};
    }

    state.roundStarterSeat = (state.roundStarterSeat + 1) % state.players.length;
    setupRound(state, state.roundIndex + 1);

    const roundConfig = getRoundConfig(state.roundIndex);
    events.push({
      type: 'king:round_started',
      payload: {
        roundIndex: state.roundIndex,
        roundKind: state.roundKind,
        roundTitle: roundConfig?.title || `Раунд ${state.roundIndex + 1}`,
        trumpSuit: state.trumpSuit,
      },
    });

    return {state, events};
  }

  state.currentLeaderSeat = winnerSeat;
  state.currentSeat = winnerSeat;
  state.leadSuit = null;
  state.currentTrick = createEmptyTrick(winnerSeat);

  return {state, events};
}

export const kingModule: GameModule = {
  key: 'king',
  kind: 'game',
  title: 'King',
  enabled: true,
  minPlayers: 4,
  maxPlayers: 4,
  supportsBots: true,

  createInitialState(input) {
    return buildInitialState(input);
  },

  getPublicState(input) {
    return toPublicState(cloneState(input.state), input.forUserId);
  },

  listActions(input) {
    const state = cloneState(input.state);
    if (state.phase !== 'playing') return [];

    const player = state.players.find((entry) => entry.userId === input.forUserId);
    if (!player) return [];
    if (state.currentSeat !== player.seat) return [];

    const legal = listLegalCards(state, player.seat);
    return legal.map((card) => ({
      type: 'play_card',
      payload: card,
    }));
  },

  applyAction(input) {
    const state = cloneState(input.state);
    const action = toAction(input.action);
    if (!action) {
      throw new Error('unsupported_action');
    }

    if (action.type === 'play_card') {
      const result = applyPlayCard(state, input.actorUserId, action);
      return {
        nextState: result.state,
        events: result.events as ModuleEvent[],
      };
    }

    throw new Error('unsupported_action');
  },

  async runBotTurn(input) {
    const state = cloneState(input.state);

    if (state.phase !== 'playing') {
      throw new Error('game_not_playing');
    }

    const player = state.players.find((entry) => entry.userId === input.actorUserId);
    if (!player) {
      throw new Error('bot_not_found');
    }

    if (state.currentSeat !== player.seat) {
      throw new Error('not_bot_turn');
    }

    const behavior = state.botBehaviorByUserId[String(player.userId)] || {
      risk: 0.4,
      chaos: 0.2,
      aggression: 0.4,
      vindictiveness: 0.3,
    };

    const card = pickBotCard({
      state,
      seat: player.seat,
      behavior,
    });

    return {
      type: 'play_card',
      payload: card,
    };
  },
};
