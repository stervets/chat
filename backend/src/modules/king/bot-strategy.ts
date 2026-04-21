import {listLegalCards, getSeatPlayer, isTrumpRound} from './rules.js';
import type {KingCard, KingGameState, KingRoundKind, KingSuit, KingBotBehavior} from './types.js';

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

function cardPenaltyWeight(card: KingCard, roundKind: KingRoundKind) {
  const isHeart = card.suit === 'hearts';
  const isJack = card.rank === 'J';
  const isQueen = card.rank === 'Q';
  const isKingHearts = isHeart && card.rank === 'K';

  if (roundKind === 'mishmash_plus') {
    let bonus = 0;
    if (isHeart) bonus += 2;
    if (isJack) bonus += 4;
    if (isQueen) bonus += 6;
    if (isKingHearts) bonus += 20;
    return bonus;
  }

  let penalty = 0;
  if (roundKind === 'no_hearts' || roundKind === 'mishmash_minus') {
    if (isHeart) penalty += 2;
  }
  if (roundKind === 'no_jacks' || roundKind === 'mishmash_minus') {
    if (isJack) penalty += 4;
  }
  if (roundKind === 'no_queens' || roundKind === 'mishmash_minus') {
    if (isQueen) penalty += 6;
  }
  if (roundKind === 'no_king_of_hearts' || roundKind === 'mishmash_minus') {
    if (isKingHearts) penalty += 20;
  }

  return penalty;
}

function trickStrength(card: KingCard, leadSuit: KingSuit | null, trumpSuit: KingSuit | null) {
  const rank = RANK_WEIGHT[card.rank];
  if (trumpSuit && card.suit === trumpSuit) {
    return 100 + rank;
  }
  if (leadSuit && card.suit === leadSuit) {
    return 50 + rank;
  }
  return rank;
}

function chooseLowest(cards: KingCard[]) {
  return [...cards].sort((left, right) => RANK_WEIGHT[left.rank] - RANK_WEIGHT[right.rank])[0];
}

function chooseHighest(cards: KingCard[]) {
  return [...cards].sort((left, right) => RANK_WEIGHT[right.rank] - RANK_WEIGHT[left.rank])[0];
}

function isWinningRound(roundKind: KingRoundKind) {
  return isTrumpRound(roundKind) || roundKind === 'mishmash_plus';
}

function deterministicRoll(input: {
  state: KingGameState;
  seat: number;
  salt: number;
}) {
  const state = input.state;
  const handSize = getSeatPlayer(state, input.seat).hand.length;
  const seed = Math.abs(
    Math.floor(
      state.sessionId * 101
      + state.roundIndex * 47
      + state.completedTricks.length * 23
      + state.currentTrick.plays.length * 13
      + handSize * 7
      + input.seat * 29
      + input.salt * 17,
    ),
  );
  return (seed % 1000) / 1000;
}

export function pickBotCard(input: {
  state: KingGameState;
  seat: number;
  behavior: KingBotBehavior;
}): KingCard {
  const player = getSeatPlayer(input.state, input.seat);
  const legalCards = listLegalCards(input.state, input.seat);
  if (!legalCards.length) {
    throw new Error('bot_no_legal_cards');
  }

  if (legalCards.length === 1) {
    return legalCards[0];
  }

  const roundKind = input.state.roundKind;
  const leadSuit = input.state.leadSuit;
  const trumpSuit = input.state.trumpSuit;
  const winningRound = isWinningRound(roundKind);
  const currentWinningStrength = input.state.currentTrick.plays.reduce((max, play) => {
    return Math.max(max, trickStrength(play.card, leadSuit, trumpSuit));
  }, Number.NEGATIVE_INFINITY);

  if (!winningRound && input.state.currentTrick.plays.length === 0) {
    const chaosRoll = deterministicRoll({
      state: input.state,
      seat: input.seat,
      salt: 1,
    });
    if (chaosRoll < input.behavior.chaos * 0.4) {
      const withPenalty = [...legalCards].sort((left, right) => {
        const leftPenalty = cardPenaltyWeight(left, roundKind);
        const rightPenalty = cardPenaltyWeight(right, roundKind);
        if (leftPenalty !== rightPenalty) {
          return rightPenalty - leftPenalty;
        }
        return RANK_WEIGHT[left.rank] - RANK_WEIGHT[right.rank];
      });
      return withPenalty[0];
    }
    return chooseLowest(legalCards);
  }

  if (winningRound) {
    const weighted = [...legalCards].sort((left, right) => {
      const leftScore = trickStrength(left, leadSuit, trumpSuit) + cardPenaltyWeight(left, roundKind) * (0.6 + input.behavior.aggression);
      const rightScore = trickStrength(right, leadSuit, trumpSuit) + cardPenaltyWeight(right, roundKind) * (0.6 + input.behavior.aggression);
      return rightScore - leftScore;
    });

    const riskRoll = deterministicRoll({
      state: input.state,
      seat: input.seat,
      salt: 2,
    });
    if (riskRoll < input.behavior.risk * 0.15) {
      return weighted[Math.min(1, weighted.length - 1)] || weighted[0];
    }

    return weighted[0];
  }

  const weighted = [...legalCards].sort((left, right) => {
    const leftStrength = trickStrength(left, leadSuit, trumpSuit);
    const rightStrength = trickStrength(right, leadSuit, trumpSuit);
    const leftWouldWin = leftStrength > currentWinningStrength;
    const rightWouldWin = rightStrength > currentWinningStrength;

    const leftScore =
      (leftWouldWin ? 100 : 0)
      + leftStrength * 2
      - cardPenaltyWeight(left, roundKind) * (1 + input.behavior.risk);

    const rightScore =
      (rightWouldWin ? 100 : 0)
      + rightStrength * 2
      - cardPenaltyWeight(right, roundKind) * (1 + input.behavior.risk);

    return leftScore - rightScore;
  });

  const safest = weighted[0];
  const fallback = chooseLowest(legalCards);

  const chaosRoll = deterministicRoll({
    state: input.state,
    seat: input.seat,
    salt: 3,
  });
  if (chaosRoll < input.behavior.chaos * 0.12) {
    return chooseHighest(legalCards);
  }

  if (safest) return safest;
  if (fallback) return fallback;

  return legalCards[0];
}

export function botHasCard(state: KingGameState, userId: number, card: KingCard) {
  const player = state.players.find((entry) => entry.userId === userId);
  if (!player) return false;
  return player.hand.some((entry) => entry.suit === card.suit && entry.rank === card.rank);
}
