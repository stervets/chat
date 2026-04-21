export type KingSuit = 'clubs' | 'diamonds' | 'hearts' | 'spades';
export type KingRank = '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K' | 'A';

export type KingCard = {
  suit: KingSuit;
  rank: KingRank;
};

export type GameSessionPlayer = {
  userId: number;
  seat: number;
  kind: 'human' | 'bot';
  joinedAt: string;
  isReady: boolean;
  user: {
    id: number;
    nickname: string;
    name: string;
    nicknameColor: string | null;
    donationBadgeUntil?: string | null;
    isBot: boolean;
    info: string | null;
  };
};

export type KingPublicState = {
  phase: 'lobby' | 'dealing' | 'playing' | 'round_end' | 'finished';
  sessionId: number;
  players: Array<{
    userId: number;
    seat: number;
    kind: 'human' | 'bot';
    cardsCount: number;
    totalScore: number;
    roundScore: number;
    tricksTaken: number;
    hand: KingCard[];
  }>;
  roundIndex: number;
  roundKind: string;
  currentSeat: number;
  currentLeaderSeat: number;
  leadSuit: KingSuit | null;
  trumpSuit: KingSuit | null;
  currentTrick: {
    leaderSeat: number;
    winnerSeat: number | null;
    plays: Array<{
      seat: number;
      card: KingCard;
    }>;
  };
  completedTricksCount: number;
  roundResults: Array<{
    roundIndex: number;
    roundKind: string;
    deltaBySeat: number[];
  }>;
  roundStarterSeat: number;
};

export type GameSessionPayload = {
  id: number;
  roomId: number;
  moduleKey: string;
  status: 'lobby' | 'active' | 'finished' | 'cancelled';
  visibility: 'solo' | 'public' | 'invite_only';
  createdById: number | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  players: GameSessionPlayer[];
  state: KingPublicState;
  actions: Array<{
    type: string;
    payload?: any;
  }>;
};

const SUIT_TO_CODE: Record<KingSuit, string> = {
  clubs: 'c',
  diamonds: 'd',
  hearts: 'h',
  spades: 's',
};

const RANK_TO_CODE: Record<KingRank, string> = {
  '7': '7',
  '8': '8',
  '9': '9',
  '10': '10',
  J: 'j',
  Q: 'q',
  K: 'k',
  A: 'a',
};

export function kingCardImage(card: KingCard | null | undefined) {
  if (!card) return '/cards/back.gif';
  const suit = SUIT_TO_CODE[card.suit];
  const rank = RANK_TO_CODE[card.rank];
  if (!suit || !rank) return '/cards/back.gif';
  return `/cards/${rank}${suit}.gif`;
}

export function kingRoundLabel(roundIndex: number, roundKind: string) {
  const labels: Record<string, string> = {
    no_tricks: 'не брать взяток',
    no_hearts: 'не брать черви',
    no_jacks: 'не брать валетов',
    no_queens: 'не брать дам',
    no_king_of_hearts: 'не брать короля червей',
    no_last_two: 'не брать две последние',
    mishmash_minus: 'ералаш "-"',
    trump_1: 'заказ козыря 1',
    trump_2: 'заказ козыря 2',
    trump_3: 'заказ козыря 3',
    trump_4: 'заказ козыря 4',
    mishmash_plus: 'ералаш "+"',
  };

  const label = labels[String(roundKind)] || String(roundKind || 'round');
  return `Раунд ${Number(roundIndex || 0) + 1}: ${label}`;
}
