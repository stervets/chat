import {getClientScriptFactory} from '../registry';
import type {ScriptEntitySnapshot} from '../../composables/types';
import type {ScriptWorkerApi, ScriptWorkerInstance} from './types';

type WorkerIncoming =
  | {type: 'init'; payload: {snapshot: ScriptEntitySnapshot; localState?: Record<string, any>}}
  | {type: 'user_action'; payload: {actionType: string; payload?: any}}
  | {type: 'shared_state'; payload: {state: Record<string, any>}}
  | {type: 'host_event'; payload: {eventType: string; payload?: any}}
  | {type: 'dispose'};

let snapshot: ScriptEntitySnapshot | null = null;
let localState: Record<string, any> = {};
let sharedState: Record<string, any> = {};
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

function buildApi(): ScriptWorkerApi {
  return {
    getSnapshot: () => cloneJson(snapshot as ScriptEntitySnapshot),
    getConfig: () => cloneJson(snapshot?.scriptConfigJson || {}),
    getSharedState: () => cloneJson(sharedState || {}),
    getLocalState: () => cloneJson(localState || {}),
    setLocalState(next) {
      localState = cloneJson(next || {});
      send('local_state', {state: localState});
    },
    setViewModel(next) {
      viewModel = cloneJson(next || {});
      send('view_model', {viewModel});
    },
    requestSharedAction(actionType, payload) {
      send('request_shared_action', {
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

function disposeRuntime() {
  if (!runtime) return;
  safeRun(() => {
    runtime?.onDispose?.();
  });
  runtime = null;
}

function initRuntime(payload: {snapshot: ScriptEntitySnapshot; localState?: Record<string, any>}) {
  disposeRuntime();
  snapshot = cloneJson(payload.snapshot);
  sharedState = cloneJson(payload.snapshot?.scriptStateJson || {});
  localState = cloneJson(payload.localState || {});
  viewModel = {};

  const factory = getClientScriptFactory(
    snapshot.entityType,
    snapshot.scriptId,
    snapshot.scriptRevision,
  );
  if (!factory) {
    send('runtime_error', {
      message: `client_script_not_found:${snapshot.entityType}:${snapshot.scriptId}@${snapshot.scriptRevision}`,
    });
    return;
  }

  runtime = factory.create(buildApi());
  safeRun(() => {
    runtime?.onInit?.();
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
    safeRun(() => {
      runtime?.onUserAction?.({
        actionType: String(data.payload?.actionType || ''),
        payload: cloneJson(data.payload?.payload),
      });
    });
    return;
  }

  if (data.type === 'shared_state') {
    sharedState = cloneJson(data.payload?.state || {});
    safeRun(() => {
      runtime?.onSharedState?.(cloneJson(sharedState));
    });
    return;
  }

  if (data.type === 'host_event') {
    safeRun(() => {
      runtime?.onHostEvent?.({
        eventType: String(data.payload?.eventType || ''),
        payload: cloneJson(data.payload?.payload),
      });
    });
    return;
  }

  if (data.type === 'dispose') {
    disposeRuntime();
  }
};
