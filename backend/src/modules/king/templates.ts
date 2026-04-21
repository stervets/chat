import type {KingRuntimeBotProfile} from './bot-cast.js';
import type {KingGameState, KingModuleEvent} from './types.js';

function bySeed(items: string[], seedRaw: number) {
  if (!items.length) return '';
  const seed = Math.abs(Math.floor(seedRaw || 0));
  return items[seed % items.length];
}

export function roundTitle(roundIndex: number, title: string) {
  return `Раунд ${roundIndex + 1}: ${title}`;
}

export function formatScoreboard(state: KingGameState) {
  const ordered = [...state.players].sort((left, right) => left.seat - right.seat);
  return ordered.map((player) => `S${player.seat + 1} ${player.totalScore >= 0 ? '+' : ''}${player.totalScore}`).join(' | ');
}

const ROUND_FINISHED_LINES = [
  'Ну и раунд, аж пальцы гудят.',
  'Считаем очки и молчим минуту.',
  'Это было грязно, но красиво.',
  'Ладно, живём дальше.',
  'Табло не врёт, внучек.',
];

const DRAMATIC_LINES = [
  'Опа, вот это разворот.',
  'Нормально так перевернуло стол.',
  'Ход сочный, признаю.',
  'Сейчас запахнет жареным.',
  'Карта в карту, как ножом.',
];

const KING_TAKEN_LINES = [
  'Короля червей поймал. Поздравляю с проблемами.',
  'КХ в кармане. Больно будет.',
  'Король червей ушёл не туда, куда мечтали.',
];

const LAST_TRICK_LINES = [
  'Последние взятки всегда самые злые.',
  'Финишные две пошли, держитесь.',
  'Концовка нервная, как и должно быть.',
];

export function pickRoundFinishedBotLine(input: {
  bot: KingRuntimeBotProfile;
  state: KingGameState;
}) {
  const seed = input.state.sessionId + input.state.roundIndex * 11 + input.bot.userId;
  return bySeed(ROUND_FINISHED_LINES, seed);
}

export function pickDramaticBotLine(input: {
  bot: KingRuntimeBotProfile;
  state: KingGameState;
  event: KingModuleEvent;
}) {
  const base = input.state.sessionId + input.bot.userId + input.state.completedTricks.length * 17;

  if (input.event.type === 'king:king_taken') {
    return bySeed(KING_TAKEN_LINES, base);
  }

  if (input.event.type === 'king:last_trick_taken') {
    return bySeed(LAST_TRICK_LINES, base);
  }

  return bySeed(DRAMATIC_LINES, base);
}

export function shouldBotReply(input: {
  bot: KingRuntimeBotProfile;
  state: KingGameState;
  event: KingModuleEvent;
}) {
  const seed = Math.abs(
    Math.floor(
      input.state.sessionId
      + input.state.roundIndex * 31
      + input.bot.userId * 13
      + input.state.completedTricks.length * 7,
    ),
  );

  const roll = (seed % 100) / 100;

  if (input.event.type === 'king:round_finished') {
    return roll < input.bot.replyProbability;
  }

  return roll < input.bot.tauntProbability * 0.7;
}
