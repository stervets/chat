import type {KingCard, KingRoundKind, KingTrick} from './types.js';

function countCards(trick: KingTrick, predicate: (card: KingCard) => boolean) {
  return trick.plays.reduce((count, play) => {
    return predicate(play.card) ? count + 1 : count;
  }, 0);
}

function containsKingOfHearts(trick: KingTrick) {
  return trick.plays.some((play) => play.card.suit === 'hearts' && play.card.rank === 'K');
}

function trickPenaltyNoTricks(_trick: KingTrick) {
  return -2;
}

function trickPenaltyNoHearts(trick: KingTrick) {
  return -2 * countCards(trick, (card) => card.suit === 'hearts');
}

function trickPenaltyNoJacks(trick: KingTrick) {
  return -4 * countCards(trick, (card) => card.rank === 'J');
}

function trickPenaltyNoQueens(trick: KingTrick) {
  return -6 * countCards(trick, (card) => card.rank === 'Q');
}

function trickPenaltyNoKingHearts(trick: KingTrick) {
  return containsKingOfHearts(trick) ? -20 : 0;
}

function trickPenaltyNoLastTwo(trickIndex: number) {
  return trickIndex >= 7 ? -10 : 0;
}

function trickBonusTrumpRound() {
  return 2;
}

function trickBonusMishmashPlus(trick: KingTrick, trickIndex: number) {
  let total = 2;
  total += 2 * countCards(trick, (card) => card.suit === 'hearts');
  total += 4 * countCards(trick, (card) => card.rank === 'J');
  total += 6 * countCards(trick, (card) => card.rank === 'Q');
  if (containsKingOfHearts(trick)) {
    total += 20;
  }
  if (trickIndex >= 7) {
    total += 10;
  }
  return total;
}

export function calcTrickDelta(roundKind: KingRoundKind, trick: KingTrick, trickIndex: number) {
  switch (roundKind) {
    case 'no_tricks':
      return trickPenaltyNoTricks(trick);
    case 'no_hearts':
      return trickPenaltyNoHearts(trick);
    case 'no_jacks':
      return trickPenaltyNoJacks(trick);
    case 'no_queens':
      return trickPenaltyNoQueens(trick);
    case 'no_king_of_hearts':
      return trickPenaltyNoKingHearts(trick);
    case 'no_last_two':
      return trickPenaltyNoLastTwo(trickIndex);
    case 'mishmash_minus':
      return (
        trickPenaltyNoTricks(trick)
        + trickPenaltyNoHearts(trick)
        + trickPenaltyNoJacks(trick)
        + trickPenaltyNoQueens(trick)
        + trickPenaltyNoKingHearts(trick)
        + trickPenaltyNoLastTwo(trickIndex)
      );
    case 'trump_1':
    case 'trump_2':
    case 'trump_3':
    case 'trump_4':
      return trickBonusTrumpRound();
    case 'mishmash_plus':
      return trickBonusMishmashPlus(trick, trickIndex);
    default:
      return 0;
  }
}

export function trickHasKingOfHearts(trick: KingTrick) {
  return containsKingOfHearts(trick);
}

export function isLastTwoTricks(trickIndex: number) {
  return trickIndex >= 7;
}
