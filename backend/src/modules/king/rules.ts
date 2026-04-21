import {getRoundConfig} from './rounds.js';
import type {
  KingCard,
  KingGameState,
  KingPlay,
  KingPlayerState,
  KingRoundKind,
  KingSuit,
  KingTrick,
} from './types.js';

export const KING_SUITS: KingSuit[] = ['clubs', 'diamonds', 'hearts', 'spades'];
export const KING_RANKS: Array<KingCard['rank']> = ['7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

const RANK_WEIGHT: Record<KingCard['rank'], number> = {
  '7': 0,
  '8': 1,
  '9': 2,
  '10': 3,
  J: 4,
  Q: 5,
  K: 6,
  A: 7,
};

function normalizeSeed(seedRaw: number) {
  const seed = Math.floor(Math.abs(seedRaw || 1));
  return seed > 0 ? seed : 1;
}

function createRng(seedRaw: number) {
  let seed = normalizeSeed(seedRaw) % 2147483647;
  if (seed <= 0) seed += 2147483646;
  return () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
}

export function cloneCard(card: KingCard): KingCard {
  return {suit: card.suit, rank: card.rank};
}

export function cardEquals(left: KingCard, right: KingCard) {
  return left.suit === right.suit && left.rank === right.rank;
}

export function cardCode(card: KingCard) {
  return `${card.rank}${card.suit[0]}`;
}

export function sortHand(hand: KingCard[]) {
  const suitWeight: Record<KingSuit, number> = {
    clubs: 0,
    diamonds: 1,
    hearts: 2,
    spades: 3,
  };

  return [...hand].sort((left, right) => {
    if (left.suit !== right.suit) {
      return suitWeight[left.suit] - suitWeight[right.suit];
    }
    return RANK_WEIGHT[left.rank] - RANK_WEIGHT[right.rank];
  });
}

export function createDeck32(): KingCard[] {
  const cards: KingCard[] = [];
  for (const suit of KING_SUITS) {
    for (const rank of KING_RANKS) {
      cards.push({suit, rank});
    }
  }
  return cards;
}

export function shuffleDeckDeterministic(cards: KingCard[], seed: number) {
  const rng = createRng(seed);
  const next = cards.map((card) => cloneCard(card));

  for (let index = next.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(rng() * (index + 1));
    const temp = next[index];
    next[index] = next[swapIndex];
    next[swapIndex] = temp;
  }

  return next;
}

function getRoundSeed(sessionId: number, roundIndex: number) {
  return sessionId * 1009 + roundIndex * 97 + 17;
}

export function createEmptyTrick(leaderSeat: number): KingTrick {
  return {
    leaderSeat,
    plays: [],
    winnerSeat: null,
  };
}

export function setupRound(state: KingGameState, roundIndex: number) {
  const round = getRoundConfig(roundIndex);
  if (!round) {
    throw new Error('round_not_found');
  }

  const shuffledDeck = shuffleDeckDeterministic(createDeck32(), getRoundSeed(state.sessionId, roundIndex));
  const players = [...state.players].sort((left, right) => left.seat - right.seat);
  const seatToPlayer = new Map(players.map((player) => [player.seat, player]));

  for (const player of players) {
    player.hand = [];
    player.roundScore = 0;
    player.tricksTaken = 0;
  }

  const seatOrder = Array.from({length: players.length}, (_, index) => {
    return (state.roundStarterSeat + index) % players.length;
  });

  for (let index = 0; index < shuffledDeck.length; index += 1) {
    const seat = seatOrder[index % players.length];
    const player = seatToPlayer.get(seat);
    if (!player) continue;
    player.hand.push(cloneCard(shuffledDeck[index]));
  }

  for (const player of players) {
    player.hand = sortHand(player.hand);
  }

  state.roundIndex = roundIndex;
  state.roundKind = round.kind;
  state.phase = 'playing';
  state.trumpSuit = round.trumpSuit;
  state.currentLeaderSeat = state.roundStarterSeat;
  state.currentSeat = state.roundStarterSeat;
  state.leadSuit = null;
  state.currentTrick = createEmptyTrick(state.currentLeaderSeat);
  state.completedTricks = [];
  state.chat.roundBotMessages = 0;
  state.chat.consecutiveBotMessages = 0;
  state.chat.lastSpeakerUserId = null;
}

export function getSeatPlayer(state: KingGameState, seat: number): KingPlayerState {
  const player = state.players.find((entry) => entry.seat === seat);
  if (!player) {
    throw new Error(`seat_not_found:${seat}`);
  }
  return player;
}

export function getUserPlayer(state: KingGameState, userId: number): KingPlayerState {
  const player = state.players.find((entry) => entry.userId === userId);
  if (!player) {
    throw new Error(`user_not_found:${userId}`);
  }
  return player;
}

function hasSuit(hand: KingCard[], suit: KingSuit) {
  return hand.some((card) => card.suit === suit);
}

export function listLegalCards(state: KingGameState, seat: number): KingCard[] {
  const player = getSeatPlayer(state, seat);
  if (!state.leadSuit) {
    return player.hand.map((card) => cloneCard(card));
  }

  if (!hasSuit(player.hand, state.leadSuit)) {
    return player.hand.map((card) => cloneCard(card));
  }

  return player.hand
    .filter((card) => card.suit === state.leadSuit)
    .map((card) => cloneCard(card));
}

export function isLegalCard(state: KingGameState, seat: number, card: KingCard) {
  const legal = listLegalCards(state, seat);
  return legal.some((entry) => cardEquals(entry, card));
}

export function takeCardFromHand(player: KingPlayerState, card: KingCard) {
  const index = player.hand.findIndex((entry) => cardEquals(entry, card));
  if (index < 0) {
    return false;
  }

  player.hand.splice(index, 1);
  return true;
}

export function pushPlay(state: KingGameState, seat: number, card: KingCard): KingPlay {
  const play: KingPlay = {
    seat,
    card: cloneCard(card),
  };

  if (!state.leadSuit) {
    state.leadSuit = card.suit;
  }

  state.currentTrick.plays.push(play);
  return play;
}

function compareCardsByRank(left: KingCard, right: KingCard) {
  return RANK_WEIGHT[left.rank] - RANK_WEIGHT[right.rank];
}

export function pickTrickWinner(
  trick: KingTrick,
  leadSuit: KingSuit,
  trumpSuit: KingSuit | null,
): number {
  let winner = trick.plays[0];
  let winnerCard = winner.card;

  for (const play of trick.plays.slice(1)) {
    const card = play.card;

    const winnerIsTrump = trumpSuit !== null && winnerCard.suit === trumpSuit;
    const cardIsTrump = trumpSuit !== null && card.suit === trumpSuit;

    if (winnerIsTrump && !cardIsTrump) continue;
    if (!winnerIsTrump && cardIsTrump) {
      winner = play;
      winnerCard = card;
      continue;
    }

    if (winnerCard.suit !== leadSuit && card.suit === leadSuit) {
      winner = play;
      winnerCard = card;
      continue;
    }

    if (winnerCard.suit === card.suit && compareCardsByRank(card, winnerCard) > 0) {
      winner = play;
      winnerCard = card;
    }
  }

  return winner.seat;
}

export function nextSeat(state: KingGameState, seat: number) {
  return (seat + 1) % state.players.length;
}

export function isTrumpRound(roundKind: KingRoundKind) {
  return roundKind === 'trump_1' || roundKind === 'trump_2' || roundKind === 'trump_3' || roundKind === 'trump_4';
}
