import type {
  ScriptActionInput,
  ScriptActionResult,
  ScriptDefinition,
  ScriptEntityType,
} from './types.js';

function normalizeScriptId(scriptIdRaw: unknown) {
  return String(scriptIdRaw || '').trim().toLowerCase();
}

function normalizeRevision(revisionRaw: unknown, fallback = 1) {
  const revision = Number.parseInt(String(revisionRaw ?? ''), 10);
  if (!Number.isFinite(revision) || revision <= 0) return fallback;
  return revision;
}

function cloneJson<T>(value: T): T {
  try {
    return JSON.parse(JSON.stringify(value)) as T;
  } catch {
    return value;
  }
}

function reduceGuessWordAction(input: ScriptActionInput): ScriptActionResult {
  const actionType = String(input.actionType || '').trim().toLowerCase();
  if (actionType !== 'submit_guess') {
    return {nextState: cloneJson(input.state || {})};
  }

  const guess = String(input.payload?.guess || '').trim().toLowerCase();
  const answer = String(input.config?.answer || '').trim().toLowerCase();
  const winners = Array.isArray(input.state?.winners) ? input.state.winners : [];
  const nowIso = new Date().toISOString();

  const alreadyWinner = winners.some((winner: any) => Number(winner?.userId || 0) === input.actor.userId);
  const isCorrect = !!guess && !!answer && guess === answer;
  const nextWinners = isCorrect && !alreadyWinner
    ? [
      ...winners,
      {
        userId: input.actor.userId,
        nickname: input.actor.nickname,
        name: input.actor.name || input.actor.nickname,
        at: nowIso,
      },
    ]
    : winners;

  const attempts = Math.max(0, Number(input.state?.attempts || 0)) + 1;

  return {
    nextState: {
      ...cloneJson(input.state || {}),
      status: 'active',
      attempts,
      winners: nextWinners,
      lastGuess: {
        byUserId: input.actor.userId,
        nickname: input.actor.nickname,
        value: guess,
        isCorrect,
        at: nowIso,
      },
    },
  };
}

const definitions: ScriptDefinition[] = [
  {
    scriptId: 'demo:fart_button',
    revision: 1,
    entityType: 'message',
    mode: 'client',
    title: 'Demo: local fart button',
    makeInitialConfig(input) {
      return {
        title: String(input?.title || 'Локальная кнопка'),
        buttonLabel: String(input?.buttonLabel || 'Пукнуть'),
        soundUrl: String(input?.soundUrl || '/ping.mp3'),
      };
    },
    makeInitialState() {
      return {};
    },
  },
  {
    scriptId: 'demo:guess_word',
    revision: 1,
    entityType: 'message',
    mode: 'client_server',
    title: 'Demo: guess word',
    makeInitialConfig(input) {
      const answer = String(input?.answer || 'marx').trim().toLowerCase();
      return {
        title: String(input?.title || 'Угадай слово'),
        answer,
        hint: String(input?.hint || `Слово из ${Math.max(1, answer.length)} букв`),
      };
    },
    makeInitialState(input) {
      const answer = String(input?.config?.answer || 'marx').trim().toLowerCase();
      return {
        status: 'active',
        mask: '*'.repeat(Math.max(1, answer.length)),
        attempts: 0,
        winners: [],
        lastGuess: null,
      };
    },
    reduceAction: reduceGuessWordAction,
  },
  // Временно отключено: скрипт "Счётчик комнаты" (demo:room_meter).
  // {
  //   scriptId: 'demo:room_meter',
  //   revision: 1,
  //   entityType: 'room',
  //   mode: 'client_runner',
  //   title: 'Demo: room meter',
  //   makeInitialConfig(input) {
  //     const announceEvery = Number.parseInt(String(input?.announceEvery ?? '5'), 10);
  //     return {
  //       title: String(input?.title || 'Счётчик комнаты'),
  //       announceEvery: Number.isFinite(announceEvery) && announceEvery > 0 ? announceEvery : 5,
  //     };
  //   },
  //   makeInitialState() {
  //     return {
  //       totalMessages: 0,
  //       lastAuthorNickname: '',
  //       updatedAt: null,
  //     };
  //   },
  // },
];

const definitionMap = new Map<string, ScriptDefinition>();
definitions.forEach((item) => {
  definitionMap.set(`${item.entityType}:${item.scriptId}:${item.revision}`, item);
});

export function listScriptDefinitions() {
  return [...definitions];
}

export function getScriptDefinition(entityTypeRaw: unknown, scriptIdRaw: unknown, revisionRaw?: unknown) {
  const entityType = String(entityTypeRaw || '').trim().toLowerCase() as ScriptEntityType;
  if (entityType !== 'message' && entityType !== 'room') return null;
  const scriptId = normalizeScriptId(scriptIdRaw);
  if (!scriptId) return null;
  const revision = normalizeRevision(revisionRaw, 1);
  return definitionMap.get(`${entityType}:${scriptId}:${revision}`) || null;
}

export function getLatestScriptDefinition(entityTypeRaw: unknown, scriptIdRaw: unknown) {
  const entityType = String(entityTypeRaw || '').trim().toLowerCase() as ScriptEntityType;
  if (entityType !== 'message' && entityType !== 'room') return null;
  const scriptId = normalizeScriptId(scriptIdRaw);
  if (!scriptId) return null;

  const matched = definitions
    .filter((item) => item.entityType === entityType && item.scriptId === scriptId)
    .sort((left, right) => right.revision - left.revision);
  return matched[0] || null;
}
