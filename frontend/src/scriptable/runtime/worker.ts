import {getClientScriptFactory} from '../registry';
import type {ScriptEntitySnapshot} from '../../composables/types';
import type {ScriptRuntimeEvent, ScriptRuntimeEventSource, ScriptWorkerApi, ScriptWorkerInstance} from './types';

type WorkerIncoming =
  | {type: 'init'; payload: {snapshot: ScriptEntitySnapshot; localState?: Record<string, any>}}
  | {type: 'user_action'; payload: {actionType: string; payload?: any}}
  | {type: 'runtime_data'; payload: {data: Record<string, any>}}
  | {type: 'host_event'; payload: {eventType?: string; type?: string; source?: ScriptRuntimeEventSource; payload?: any}}
  | {type: 'dispose'};

let snapshot: ScriptEntitySnapshot | null = null;
let localState: Record<string, any> = {};
let runtimeData: Record<string, any> = {};
let viewModel: Record<string, any> = {};
let runtime: ScriptWorkerInstance | null = null;

function send(type: string, payload: any) {
  (self as unknown as Worker).postMessage({type, payload});
}

function cloneJson<T>(value: T): T {
  try {
    return JSON.parse(JSON.stringify(value)) as T;
  } catch {
    return value;
  }
}

function runtimeScriptId(snapshotRaw: ScriptEntitySnapshot | null) {
  return String(snapshotRaw?.clientScript || '').trim().toLowerCase();
}

function currentRuntimeData() {
  return cloneJson(runtimeData || {});
}

function buildApi(): ScriptWorkerApi {
  return {
    getSnapshot: () => cloneJson(snapshot as ScriptEntitySnapshot),
    getData: () => currentRuntimeData(),
    getLocalState: () => cloneJson(localState || {}),
    setLocalState(next) {
      localState = cloneJson(next || {});
      send('local_state', {state: localState});
    },
    setViewModel(next) {
      viewModel = cloneJson(next || {});
      send('view_model', {viewModel});
    },
    requestRuntimeAction(actionType, payload) {
      send('request_runtime_action', {
        actionType: String(actionType || ''),
        payload: cloneJson(payload),
      });
    },
  };
}

function safeRun(fn: () => void) {
  try {
    fn();
  } catch (error: any) {
    send('runtime_error', {
      message: String(error?.message || error || 'worker_runtime_error'),
    });
  }
}

function normalizeRuntimeEventSource(raw: unknown): ScriptRuntimeEventSource {
  const source = String(raw || '').trim().toLowerCase();
  if (source === 'ui' || source === 'room' || source === 'server' || source === 'system') {
    return source;
  }
  return 'system';
}

function emitRuntimeEvent(event: ScriptRuntimeEvent) {
  if (!runtime) return;
  safeRun(() => {
    runtime?.onEvent?.(cloneJson(event));
  });
}

function disposeRuntime() {
  if (!runtime) return;
  emitRuntimeEvent({
    source: 'system',
    type: 'runtime:dispose',
  });
  safeRun(() => {
    runtime?.onDispose?.();
  });
  runtime = null;
}

function initRuntime(payload: {snapshot: ScriptEntitySnapshot; localState?: Record<string, any>}) {
  disposeRuntime();
  snapshot = cloneJson(payload.snapshot);
  runtimeData = cloneJson(snapshot?.data || {});
  localState = cloneJson(payload.localState || {});
  viewModel = {};

  const scriptId = runtimeScriptId(snapshot);
  if (!scriptId) {
    send('runtime_error', {
      message: `client_script_not_found:${snapshot.nodeType}:missing_script_id`,
    });
    return;
  }

  const factory = getClientScriptFactory(
    snapshot.nodeType,
    scriptId,
  );
  if (!factory) {
    send('runtime_error', {
      message: `client_script_not_found:${snapshot.nodeType}:${scriptId}`,
    });
    return;
  }

  runtime = factory.create(buildApi());
  safeRun(() => {
    runtime?.onInit?.();
  });
  emitRuntimeEvent({
    source: 'system',
    type: 'runtime:init',
    payload: {
      nodeType: snapshot.nodeType,
      nodeId: snapshot.nodeId,
      roomId: snapshot.roomId,
      clientScript: snapshot.clientScript,
      serverScript: snapshot.serverScript,
      data: cloneJson(snapshot.data || {}),
    },
  });
}

self.onmessage = (event: MessageEvent<WorkerIncoming>) => {
  const data = event.data;
  if (!data || typeof data !== 'object') return;

  if (data.type === 'init') {
    initRuntime(data.payload);
    return;
  }

  if (!runtime) return;

  if (data.type === 'user_action') {
    const actionType = String(data.payload?.actionType || '');
    const actionPayload = cloneJson(data.payload?.payload);
    emitRuntimeEvent({
      source: 'ui',
      type: 'ui:action',
      payload: {
        actionType,
        payload: actionPayload,
      },
    });
    return;
  }

  if (data.type === 'runtime_data') {
    runtimeData = cloneJson(data.payload?.data || {});
    emitRuntimeEvent({
      source: 'server',
      type: 'data:update',
      payload: {
        data: currentRuntimeData(),
      },
    });
    return;
  }

  if (data.type === 'host_event') {
    const eventType = String(data.payload?.type || data.payload?.eventType || '').trim();
    if (!eventType) return;
    const payload = cloneJson(data.payload?.payload);
    const source = normalizeRuntimeEventSource(data.payload?.source);
    emitRuntimeEvent({
      source,
      type: eventType,
      payload,
    });
    return;
  }

  if (data.type === 'dispose') {
    disposeRuntime();
  }
};
