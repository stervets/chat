import type {RunnerRequest, RunnerResponse} from '../scriptable/runner-protocol.js';
import type {ScriptSideEffect} from '../scriptable/types.js';

type RunnerScriptResult = {
  data: any;
  sideEffects?: ScriptSideEffect[];
};

type RunnerScriptHandler = {
  serverScript: string;
  nodeType: 'message' | 'room';
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
  const data = cloneJson(request.payload.data || {});
  const state = cloneJson(data?.scriptState || {});
  const config = cloneJson(data?.scriptConfig || {});
  const announceEvery = Math.max(1, Number(config?.announceEvery || 5));
  const eventType = String(request.payload.eventType || '').trim().toLowerCase();
  const eventPayload = cloneJson(request.payload.eventPayload || {});

  if (eventType !== 'message_created') {
    return {data};
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
    data: {
      ...data,
      scriptState: nextState,
    },
    sideEffects,
  };
}

const scripts: RunnerScriptHandler[] = [
  // Временно отключено: скрипт "Счётчик комнаты" (demo:room_meter).
  // {
  //   serverScript: 'demo:room_meter',
  //   nodeType: 'room',
  //   onRoomEvent: createRoomMeterResult,
  //   onEntityAction: createRoomMeterResult,
  // },
];

const scriptMap = new Map<string, RunnerScriptHandler>();
scripts.forEach((script) => {
  scriptMap.set(`${script.nodeType}:${script.serverScript}`, script);
});

function findScript(request: RunnerRequest) {
  const serverScript = String(request.payload.serverScript || '').trim().toLowerCase();
  if (!serverScript) return null;
  return scriptMap.get(
    `${request.payload.nodeType}:${serverScript}`,
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
    data: cloneJson(result.data || {}),
    sideEffects: cloneJson(result.sideEffects || []),
  };
}
