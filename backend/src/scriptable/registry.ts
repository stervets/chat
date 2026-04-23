import type {
  ScriptActionInput,
  ScriptActionResult,
  ScriptDefinition,
  ScriptNodeType,
} from './types.js';

function normalizeScriptId(scriptIdRaw: unknown) {
  return String(scriptIdRaw || '').trim().toLowerCase();
}

function cloneJson<T>(value: T): T {
  try {
    return JSON.parse(JSON.stringify(value)) as T;
  } catch {
    return value;
  }
}

function asRecord(raw: unknown) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  return cloneJson(raw as Record<string, any>);
}

function readConfig(dataRaw: unknown) {
  return asRecord(asRecord(dataRaw).config);
}

function readState(dataRaw: unknown) {
  return asRecord(asRecord(dataRaw).state);
}

function withState(dataRaw: unknown, nextState: unknown) {
  return {
    ...asRecord(dataRaw),
    state: asRecord(nextState),
  };
}

function withData(configRaw: unknown, stateRaw: unknown) {
  return {
    config: asRecord(configRaw),
    state: asRecord(stateRaw),
  };
}

function reduceGuessWordAction(input: ScriptActionInput): ScriptActionResult {
  const actionType = String(input.actionType || '').trim().toLowerCase();
  if (actionType !== 'submit_guess') {
    return {nextData: cloneJson(input.data || {})};
  }

  const guess = String(input.payload?.guess || '').trim().toLowerCase();
  const config = readConfig(input.data);
  const state = readState(input.data);
  const answer = String(config.answer || '').trim().toLowerCase();
  const winners = Array.isArray(state?.winners) ? state.winners : [];
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

  const attempts = Math.max(0, Number(state?.attempts || 0)) + 1;

  return {
    nextData: withState(input.data, {
      ...state,
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
    }),
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
  const config = readConfig(input.data);
  const state = readState(input.data);
  const options = normalizePollOptions(config.options);
  const normalizedState = buildPollState(state, options);

  if (actionType !== 'vote') {
    return {nextData: withState(input.data, normalizedState)};
  }

  const optionIndex = Number(input.payload?.optionIndex);
  if (!Number.isFinite(optionIndex) || optionIndex < 0 || optionIndex >= options.length) {
    return {nextData: withState(input.data, normalizedState)};
  }

  const votesByUser = {
    ...(normalizedState.votesByUser || {}),
    [String(input.actor.userId)]: optionIndex,
  };

  return {
    nextData: withState(input.data, buildPollState(
      {
        ...normalizedState,
        votesByUser,
        updatedAt: new Date().toISOString(),
      },
      options,
    )),
  };
}

function clampBotLevel(raw: unknown) {
  const value = Number(raw);
  if (!Number.isFinite(value)) return 50;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function reduceBotControlAction(input: ScriptActionInput): ScriptActionResult {
  const actionType = String(input.actionType || '').trim().toLowerCase();
  const prevState = readState(input.data);
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
    return {nextData: withState(input.data, nextState)};
  }

  nextState.updatedAt = new Date().toISOString();
  nextState.lastAction = {
    type: actionType,
    byUserId: input.actor.userId,
    nickname: input.actor.nickname,
    at: nextState.updatedAt,
  };

  return {
    nextData: withState(input.data, nextState),
  };
}

const definitions: ScriptDefinition[] = [
  {
    scriptId: 'demo:fart_button',
    nodeType: 'message',
    clientScript: 'demo:fart_button',
    serverScript: null,
    createData(input) {
      return withData({
        title: String(input?.title || 'Локальная кнопка'),
        buttonLabel: String(input?.buttonLabel || 'Пукнуть'),
        soundUrl: String(input?.soundUrl || '/ping.mp3'),
      }, {});
    },
  },
  {
    scriptId: 'demo:guess_word',
    nodeType: 'message',
    clientScript: 'demo:guess_word',
    serverScript: 'demo:guess_word',
    createData(input) {
      const answer = String(input?.answer || 'marx').trim().toLowerCase();
      const config = {
        title: String(input?.title || 'Угадай слово'),
        answer,
        hint: String(input?.hint || `Слово из ${Math.max(1, answer.length)} букв`),
      };
      return withData(config, {
        status: 'active',
        mask: '*'.repeat(Math.max(1, answer.length)),
        attempts: 0,
        winners: [],
        lastGuess: null,
      });
    },
    reduceAction: reduceGuessWordAction,
  },
  {
    scriptId: 'demo:poll_surface',
    nodeType: 'message',
    clientScript: 'demo:poll_surface',
    serverScript: 'demo:poll_surface',
    createData(input) {
      const options = normalizePollOptions(input?.options);
      const config = {
        title: String(input?.title || 'Голосование'),
        question: String(input?.question || 'Выберите вариант'),
        options,
      };
      return withData(config, buildPollState({}, config.options));
    },
    reduceAction: reducePollAction,
  },
  {
    scriptId: 'demo:bot_control_surface',
    nodeType: 'message',
    clientScript: 'demo:bot_control_surface',
    serverScript: 'demo:bot_control_surface',
    createData(input) {
      const config = {
        title: String(input?.title || 'Bot control'),
      };
      return withData(config, {
        enabled: !!input?.initialEnabled,
        level: clampBotLevel(input?.initialLevel),
        updatedAt: null,
        lastAction: null,
      });
    },
    reduceAction: reduceBotControlAction,
  },
  // Временно отключено: скрипт "Счётчик комнаты" (demo:room_meter).
  // {
  //   scriptId: 'demo:room_meter',
  //   nodeType: 'room',
  //   clientScript: null,
  //   serverScript: 'demo:room_meter',
  //   createData(input) {
  //     const announceEvery = Number.parseInt(String(input?.announceEvery ?? '5'), 10);
  //     return withData({
  //       title: String(input?.title || 'Счётчик комнаты'),
  //       announceEvery: Number.isFinite(announceEvery) && announceEvery > 0 ? announceEvery : 5,
  //     }, {
  //       totalMessages: 0,
  //       lastAuthorNickname: '',
  //       updatedAt: null,
  //     });
  //   },
  // },
];

const definitionMap = new Map<string, ScriptDefinition>();
definitions.forEach((item) => {
  definitionMap.set(`${item.nodeType}:${item.scriptId}`, item);
});

export function getScriptDefinition(nodeTypeRaw: unknown, scriptIdRaw: unknown) {
  const nodeType = String(nodeTypeRaw || '').trim().toLowerCase() as ScriptNodeType;
  if (nodeType !== 'message' && nodeType !== 'room') return null;
  const scriptId = normalizeScriptId(scriptIdRaw);
  if (!scriptId) return null;
  return definitionMap.get(`${nodeType}:${scriptId}`) || null;
}
