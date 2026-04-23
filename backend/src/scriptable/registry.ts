import type {
  ScriptActionInput,
  ScriptActionResult,
  ScriptDefinition,
  ScriptNodeType,
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

function normalizePollOptions(raw: unknown) {
  const options = Array.isArray(raw)
    ? raw
      .map((item) => String(item || '').trim())
      .filter(Boolean)
      .slice(0, 8)
    : [];
  if (options.length >= 2) return options;
  return ['Да', 'Нет'];
}

function buildPollState(stateRaw: unknown, optionsRaw: unknown) {
  const options = normalizePollOptions(optionsRaw);
  const previous = stateRaw && typeof stateRaw === 'object' ? cloneJson(stateRaw as Record<string, any>) : {};
  const votesByUserRaw = previous.votesByUser && typeof previous.votesByUser === 'object'
    ? previous.votesByUser as Record<string, number>
    : {};

  const normalizedVotesByUser: Record<string, number> = {};
  Object.entries(votesByUserRaw).forEach(([userId, optionIndexRaw]) => {
    const optionIndex = Number(optionIndexRaw);
    if (!Number.isFinite(optionIndex) || optionIndex < 0 || optionIndex >= options.length) return;
    normalizedVotesByUser[String(userId)] = optionIndex;
  });

  const totals = options.map((label, index) => ({
    index,
    label,
    votes: 0,
  }));
  Object.values(normalizedVotesByUser).forEach((optionIndex) => {
    if (!totals[optionIndex]) return;
    totals[optionIndex].votes += 1;
  });

  return {
    status: 'active',
    options: totals,
    votesByUser: normalizedVotesByUser,
    totalVotes: Object.keys(normalizedVotesByUser).length,
    updatedAt: String(previous.updatedAt || ''),
  };
}

function reducePollAction(input: ScriptActionInput): ScriptActionResult {
  const actionType = String(input.actionType || '').trim().toLowerCase();
  const options = normalizePollOptions(input.config?.options);
  const state = buildPollState(input.state, options);

  if (actionType !== 'vote') {
    return {nextState: state};
  }

  const optionIndex = Number(input.payload?.optionIndex);
  if (!Number.isFinite(optionIndex) || optionIndex < 0 || optionIndex >= options.length) {
    return {nextState: state};
  }

  const votesByUser = {
    ...(state.votesByUser || {}),
    [String(input.actor.userId)]: optionIndex,
  };

  return {
    nextState: buildPollState(
      {
        ...state,
        votesByUser,
        updatedAt: new Date().toISOString(),
      },
      options,
    ),
  };
}

function clampBotLevel(raw: unknown) {
  const value = Number(raw);
  if (!Number.isFinite(value)) return 50;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function reduceBotControlAction(input: ScriptActionInput): ScriptActionResult {
  const actionType = String(input.actionType || '').trim().toLowerCase();
  const prevState = input.state && typeof input.state === 'object'
    ? cloneJson(input.state as Record<string, any>)
    : {};
  const nextState = {
    enabled: !!prevState.enabled,
    level: clampBotLevel(prevState.level),
    updatedAt: String(prevState.updatedAt || ''),
    lastAction: prevState.lastAction && typeof prevState.lastAction === 'object'
      ? cloneJson(prevState.lastAction)
      : null,
  };

  if (actionType === 'toggle_enabled') {
    const hasExplicitEnabled = typeof input.payload?.enabled === 'boolean';
    nextState.enabled = hasExplicitEnabled ? !!input.payload.enabled : !nextState.enabled;
  } else if (actionType === 'set_level') {
    nextState.level = clampBotLevel(input.payload?.level);
  } else {
    return {nextState};
  }

  nextState.updatedAt = new Date().toISOString();
  nextState.lastAction = {
    type: actionType,
    byUserId: input.actor.userId,
    nickname: input.actor.nickname,
    at: nextState.updatedAt,
  };

  return {
    nextState,
  };
}

const definitions: ScriptDefinition[] = [
  {
    scriptId: 'demo:fart_button',
    revision: 1,
    nodeType: 'message',
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
    nodeType: 'message',
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
  {
    scriptId: 'demo:poll_surface',
    revision: 1,
    nodeType: 'message',
    mode: 'client_server',
    title: 'Demo: poll surface',
    makeInitialConfig(input) {
      const options = normalizePollOptions(input?.options);
      return {
        title: String(input?.title || 'Голосование'),
        question: String(input?.question || 'Выберите вариант'),
        options,
      };
    },
    makeInitialState(input) {
      return buildPollState({}, input?.config?.options);
    },
    reduceAction: reducePollAction,
  },
  {
    scriptId: 'demo:bot_control_surface',
    revision: 1,
    nodeType: 'message',
    mode: 'client_server',
    title: 'Demo: bot control surface',
    makeInitialConfig(input) {
      return {
        title: String(input?.title || 'Bot control'),
      };
    },
    makeInitialState(input) {
      return {
        enabled: !!input?.config?.initialEnabled,
        level: clampBotLevel(input?.config?.initialLevel),
        updatedAt: null,
        lastAction: null,
      };
    },
    reduceAction: reduceBotControlAction,
  },
  // Временно отключено: скрипт "Счётчик комнаты" (demo:room_meter).
  // {
  //   scriptId: 'demo:room_meter',
  //   revision: 1,
  //   nodeType: 'room',
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
  definitionMap.set(`${item.nodeType}:${item.scriptId}:${item.revision}`, item);
});

export function listScriptDefinitions() {
  return [...definitions];
}

export function getScriptDefinition(nodeTypeRaw: unknown, scriptIdRaw: unknown, revisionRaw?: unknown) {
  const nodeType = String(nodeTypeRaw || '').trim().toLowerCase() as ScriptNodeType;
  if (nodeType !== 'message' && nodeType !== 'room') return null;
  const scriptId = normalizeScriptId(scriptIdRaw);
  if (!scriptId) return null;
  const revision = normalizeRevision(revisionRaw, 1);
  return definitionMap.get(`${nodeType}:${scriptId}:${revision}`) || null;
}

export function getLatestScriptDefinition(nodeTypeRaw: unknown, scriptIdRaw: unknown) {
  const nodeType = String(nodeTypeRaw || '').trim().toLowerCase() as ScriptNodeType;
  if (nodeType !== 'message' && nodeType !== 'room') return null;
  const scriptId = normalizeScriptId(scriptIdRaw);
  if (!scriptId) return null;

  const matched = definitions
    .filter((item) => item.nodeType === nodeType && item.scriptId === scriptId)
    .sort((left, right) => right.revision - left.revision);
  return matched[0] || null;
}
