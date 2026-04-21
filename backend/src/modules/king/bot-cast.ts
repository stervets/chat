import type {KingBotBehavior} from './types.js';

export type KingBotSeedProfile = {
  id: string;
  nickname: string;
  name: string;
  info: string;
  behavior: KingBotBehavior;
  replyProbability: number;
  tauntProbability: number;
};

export type KingRuntimeBotProfile = KingBotSeedProfile & {
  userId: number;
};

export const KING_BOT_CAST: KingBotSeedProfile[] = [
  {
    id: 'nastasya',
    nickname: '!nastasya',
    name: 'Настасья',
    info: 'Персонаж из фильма «Даун Хаус». Характер резкий, любит поддеть оппонента.',
    behavior: {risk: 0.72, chaos: 0.41, aggression: 0.78, vindictiveness: 0.8},
    replyProbability: 0.52,
    tauntProbability: 0.43,
  },
  {
    id: 'rogozhin',
    nickname: '!rogozhin',
    name: 'Рогожин',
    info: 'Персонаж из фильма «Даун Хаус». Жёсткий, мрачный, играет силово.',
    behavior: {risk: 0.62, chaos: 0.22, aggression: 0.87, vindictiveness: 0.72},
    replyProbability: 0.38,
    tauntProbability: 0.51,
  },
  {
    id: 'ferdyshenko',
    nickname: '!ferdyshenko',
    name: 'Фердыщенко',
    info: 'Персонаж из фильма «Даун Хаус». Провокатор и тролль, любит хаос.',
    behavior: {risk: 0.81, chaos: 0.86, aggression: 0.61, vindictiveness: 0.48},
    replyProbability: 0.68,
    tauntProbability: 0.66,
  },
  {
    id: 'ganya',
    nickname: '!ganya',
    name: 'Ганя',
    info: 'Персонаж из фильма «Даун Хаус». Играет осторожно, но при случае мстит.',
    behavior: {risk: 0.35, chaos: 0.19, aggression: 0.46, vindictiveness: 0.63},
    replyProbability: 0.29,
    tauntProbability: 0.24,
  },
  {
    id: 'ippolit',
    nickname: '!ippolit',
    name: 'Ипполит',
    info: 'Персонаж из фильма «Даун Хаус». Холодный и расчётливый, любит длинную игру.',
    behavior: {risk: 0.28, chaos: 0.13, aggression: 0.39, vindictiveness: 0.35},
    replyProbability: 0.22,
    tauntProbability: 0.16,
  },
];

export function bindKingBotCast(
  botUsers: Array<{id: number}>,
): KingRuntimeBotProfile[] {
  const sortedUsers = [...botUsers]
    .filter((user) => Number.isFinite(user.id) && user.id > 0)
    .sort((left, right) => left.id - right.id);

  const count = Math.min(KING_BOT_CAST.length, sortedUsers.length);
  const profiles: KingRuntimeBotProfile[] = [];

  for (let index = 0; index < count; index += 1) {
    const base = KING_BOT_CAST[index];
    const user = sortedUsers[index];
    profiles.push({
      ...base,
      userId: user.id,
    });
  }

  return profiles;
}

export function getBotProfileByUserId(
  botCast: KingRuntimeBotProfile[],
  userId: number,
): KingRuntimeBotProfile | null {
  return botCast.find((entry) => entry.userId === userId) || null;
}
