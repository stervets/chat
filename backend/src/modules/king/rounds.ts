import type {KingRoundKind, KingSuit} from './types.js';

export type KingRoundConfig = {
  index: number;
  kind: KingRoundKind;
  title: string;
  trumpSuit: KingSuit | null;
};

export const KING_ROUNDS: KingRoundConfig[] = [
  {index: 0, kind: 'no_tricks', title: 'Раунд 1: не брать взяток', trumpSuit: null},
  {index: 1, kind: 'no_hearts', title: 'Раунд 2: не брать черви', trumpSuit: null},
  {index: 2, kind: 'no_jacks', title: 'Раунд 3: не брать валетов', trumpSuit: null},
  {index: 3, kind: 'no_queens', title: 'Раунд 4: не брать дам', trumpSuit: null},
  {index: 4, kind: 'no_king_of_hearts', title: 'Раунд 5: не брать короля червей', trumpSuit: null},
  {index: 5, kind: 'no_last_two', title: 'Раунд 6: не брать две последние', trumpSuit: null},
  {index: 6, kind: 'mishmash_minus', title: 'Раунд 7: ералаш "-"', trumpSuit: null},
  {index: 7, kind: 'trump_1', title: 'Раунд 8: заказ козыря 1', trumpSuit: 'clubs'},
  {index: 8, kind: 'trump_2', title: 'Раунд 9: заказ козыря 2', trumpSuit: 'diamonds'},
  {index: 9, kind: 'trump_3', title: 'Раунд 10: заказ козыря 3', trumpSuit: 'hearts'},
  {index: 10, kind: 'trump_4', title: 'Раунд 11: заказ козыря 4', trumpSuit: 'spades'},
  {index: 11, kind: 'mishmash_plus', title: 'Раунд 12: ералаш "+"', trumpSuit: null},
];

export function getRoundConfig(roundIndex: number) {
  return KING_ROUNDS[roundIndex] || null;
}
