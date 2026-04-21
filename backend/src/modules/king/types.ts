import type {ModuleEvent} from '../../modules-runtime/types.js';

export type KingSuit = 'clubs' | 'diamonds' | 'hearts' | 'spades';
export type KingRank = '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K' | 'A';

export type KingCard = {
  suit: KingSuit;
  rank: KingRank;
};

export type KingRoundKind =
  | 'no_tricks'
  | 'no_hearts'
  | 'no_jacks'
  | 'no_queens'
  | 'no_king_of_hearts'
  | 'no_last_two'
  | 'mishmash_minus'
  | 'trump_1'
  | 'trump_2'
  | 'trump_3'
  | 'trump_4'
  | 'mishmash_plus';

export type KingPhase = 'lobby' | 'dealing' | 'playing' | 'round_end' | 'finished';

export type KingPlay = {
  seat: number;
  card: KingCard;
};

export type KingTrick = {
  leaderSeat: number;
  plays: KingPlay[];
  winnerSeat: number | null;
};

export type KingPlayerState = {
  userId: number;
  seat: number;
  kind: 'human' | 'bot';
  hand: KingCard[];
  totalScore: number;
  roundScore: number;
  tricksTaken: number;
};

export type KingRoundResult = {
  roundIndex: number;
  roundKind: KingRoundKind;
  deltaBySeat: number[];
};

export type KingChatState = {
  roundBotMessages: number;
  consecutiveBotMessages: number;
  lastSpeakerUserId: number | null;
};

export type KingBotBehavior = {
  risk: number;
  chaos: number;
  aggression: number;
  vindictiveness: number;
};

export type KingGameState = {
  phase: KingPhase;
  sessionId: number;
  players: KingPlayerState[];
  roundIndex: number;
  roundKind: KingRoundKind;
  currentSeat: number;
  currentLeaderSeat: number;
  leadSuit: KingSuit | null;
  trumpSuit: KingSuit | null;
  currentTrick: KingTrick;
  completedTricks: KingTrick[];
  roundResults: KingRoundResult[];
  roundStarterSeat: number;
  chat: KingChatState;
  botBehaviorByUserId: Record<string, KingBotBehavior>;
};

export type KingPublicPlayerState = {
  userId: number;
  seat: number;
  kind: 'human' | 'bot';
  cardsCount: number;
  totalScore: number;
  roundScore: number;
  tricksTaken: number;
  hand: KingCard[];
};

export type KingPublicState = {
  phase: KingPhase;
  sessionId: number;
  players: KingPublicPlayerState[];
  roundIndex: number;
  roundKind: KingRoundKind;
  currentSeat: number;
  currentLeaderSeat: number;
  leadSuit: KingSuit | null;
  trumpSuit: KingSuit | null;
  currentTrick: KingTrick;
  completedTricksCount: number;
  roundResults: KingRoundResult[];
  roundStarterSeat: number;
};

export type KingPlayCardAction = {
  type: 'play_card';
  payload: KingCard;
};

export type KingModuleAction = KingPlayCardAction;

export type KingModuleEvent = ModuleEvent | {
  type:
    | 'king:round_started'
    | 'king:card_played'
    | 'king:trick_finished'
    | 'king:round_finished'
    | 'king:match_finished'
    | 'king:king_taken'
    | 'king:last_trick_taken';
  payload?: any;
};
