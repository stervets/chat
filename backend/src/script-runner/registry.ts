import type {RunnerRequest, RunnerResponse} from '../scriptable/runner-protocol.js';
import type {ScriptSideEffect} from '../scriptable/types.js';

type RunnerScriptResult = {
  state: any;
  sideEffects?: ScriptSideEffect[];
};

type RunnerScriptHandler = {
  scriptId: string;
  revision: number;
  entityType: 'message' | 'room';
  onRoomEvent?: (request: RunnerRequest) => RunnerScriptResult;
  onEntityAction?: (request: RunnerRequest) => RunnerScriptResult;
};

function cloneJson<T>(value: T): T {
  try {
    return JSON.parse(JSON.stringify(value)) as T;
  } catch {
    return value;
  }
}

function createRoomMeterResult(request: RunnerRequest): RunnerScriptResult {
  const state = cloneJson(request.payload.scriptStateJson || {});
  const config = cloneJson(request.payload.scriptConfigJson || {});
  const announceEvery = Math.max(1, Number(config?.announceEvery || 5));
  const eventType = String(request.payload.eventType || '').trim().toLowerCase();
  const eventPayload = cloneJson(request.payload.eventPayload || {});

  if (eventType !== 'message_created') {
    return {state};
  }

  const totalMessages = Math.max(0, Number(state?.totalMessages || 0)) + 1;
  const lastAuthorNickname = String(eventPayload?.authorNickname || '').trim();
  const updatedAt = new Date().toISOString();
  const nextState = {
    ...state,
    totalMessages,
    lastAuthorNickname,
    updatedAt,
  };

  const sideEffects: ScriptSideEffect[] = [];
  if (totalMessages % announceEvery === 0) {
    sideEffects.push({
      type: 'system_message',
      text: `Скрипт комнаты: уже ${totalMessages} сообщений в этой комнате.`,
    });
  }

  return {
    state: nextState,
    sideEffects,
  };
}

const scripts: RunnerScriptHandler[] = [
  // Временно отключено: скрипт "Счётчик комнаты" (demo:room_meter).
  // {
  //   scriptId: 'demo:room_meter',
  //   revision: 1,
  //   entityType: 'room',
  //   onRoomEvent: createRoomMeterResult,
  //   onEntityAction: createRoomMeterResult,
  // },
];

const scriptMap = new Map<string, RunnerScriptHandler>();
scripts.forEach((script) => {
  scriptMap.set(`${script.entityType}:${script.scriptId}:${script.revision}`, script);
});

function findScript(request: RunnerRequest) {
  return scriptMap.get(
    `${request.payload.entityType}:${request.payload.scriptId}:${request.payload.scriptRevision}`,
  ) || null;
}

export function handleRunnerRequest(request: RunnerRequest): RunnerResponse {
  const script = findScript(request);
  if (!script) {
    return {
      id: request.id,
      ok: false,
      error: 'runner_script_not_found',
    };
  }

  const result = request.type === 'room_event'
    ? script.onRoomEvent?.(request)
    : script.onEntityAction?.(request);
  if (!result) {
    return {
      id: request.id,
      ok: false,
      error: 'runner_handler_not_supported',
    };
  }

  return {
    id: request.id,
    ok: true,
    state: cloneJson(result.state || {}),
    sideEffects: cloneJson(result.sideEffects || []),
  };
}
