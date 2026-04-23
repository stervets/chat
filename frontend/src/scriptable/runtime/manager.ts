import type {ScriptEntitySnapshot} from '@/composables/types';
import type {ScriptRuntimeEventSource} from './types';

type RuntimeActionRequest = {
  actionType: string;
  payload?: any;
};

type RuntimeRecord = {
  snapshot: ScriptEntitySnapshot;
  descriptorKey: string;
  localState: Record<string, any>;
  viewModel: Record<string, any>;
  mountedViewKeys: Set<string>;
  alive: boolean;
  worker: Worker;
};

type RuntimeManagerOptions = {
  onViewModel: (nodeType: 'message' | 'room', nodeId: number, viewModel: Record<string, any>) => void;
  onError?: (nodeType: 'message' | 'room', nodeId: number, errorMessage: string) => void;
  requestRuntimeAction: (snapshot: ScriptEntitySnapshot, request: RuntimeActionRequest) => Promise<{
    ok: boolean;
    data?: Record<string, any>;
  }>;
};

function cloneJson<T>(value: T): T {
  try {
    return JSON.parse(JSON.stringify(value)) as T;
  } catch {
    return value;
  }
}

function runtimeScriptId(snapshot: ScriptEntitySnapshot) {
  return String(snapshot.clientScript || '').trim().toLowerCase();
}

function buildEntityKey(nodeType: 'message' | 'room', nodeId: number) {
  return `${nodeType}:${nodeId}`;
}

function buildDescriptorKey(snapshot: ScriptEntitySnapshot) {
  return [
    snapshot.nodeType,
    snapshot.nodeId,
    runtimeScriptId(snapshot),
    String(snapshot.serverScript || '').trim().toLowerCase(),
  ].join(':');
}

function normalizeEventSource(raw: unknown, fallback: ScriptRuntimeEventSource = 'system'): ScriptRuntimeEventSource {
  const value = String(raw || '').trim().toLowerCase();
  if (value === 'ui' || value === 'room' || value === 'server' || value === 'system') {
    return value;
  }
  return fallback;
}

function normalizeViewSource(raw: unknown) {
  const value = String(raw || '').trim().toLowerCase();
  if (value === 'timeline' || value === 'pinned') return value;
  return 'unknown';
}

function buildViewKey(viewSourceRaw: unknown, viewInstanceIdRaw: unknown) {
  const viewSource = normalizeViewSource(viewSourceRaw);
  const viewInstanceId = String(viewInstanceIdRaw || '').trim();
  return `${viewSource}:${viewInstanceId || 'default'}`;
}

function isSnapshotScriptable(snapshot: ScriptEntitySnapshot | null | undefined) {
  if (!snapshot) return false;
  return !!runtimeScriptId(snapshot);
}

function withRuntimeData(snapshot: ScriptEntitySnapshot, dataRaw: unknown) {
  const data = dataRaw && typeof dataRaw === 'object' && !Array.isArray(dataRaw)
    ? cloneJson(dataRaw)
    : {};
  return {
    ...snapshot,
    data,
  } satisfies ScriptEntitySnapshot;
}

export class ScriptRuntimeManager {
  private readonly runtimes = new Map<string, RuntimeRecord>();
  private readonly pendingMountedViews = new Map<string, Set<string>>();

  constructor(private readonly options: RuntimeManagerOptions) {}

  private postToWorker(record: RuntimeRecord, message: any) {
    if (!record.alive) return false;
    try {
      record.worker.postMessage(message);
      return true;
    } catch {
      return false;
    }
  }

  private emitRuntimeEvent(
    record: RuntimeRecord,
    sourceRaw: unknown,
    eventTypeRaw: unknown,
    payload?: any,
  ) {
    const eventType = String(eventTypeRaw || '').trim();
    if (!eventType) return;

    this.postToWorker(record, {
      type: 'host_event',
      payload: {
        source: normalizeEventSource(sourceRaw),
        type: eventType,
        payload: cloneJson(payload),
      },
    });
  }

  private disposeRecord(record: RuntimeRecord) {
    if (!record.alive) return;

    if (record.mountedViewKeys.size > 0) {
      this.emitRuntimeEvent(record, 'system', 'lifecycle:unmount', {
        reason: 'runtime_dispose',
        viewCount: 0,
      });
    }

    this.postToWorker(record, {type: 'dispose'});
    record.alive = false;
    record.mountedViewKeys.clear();
    record.worker.onmessage = null;
    record.worker.onerror = null;
    record.worker.terminate();
  }

  disposeAll() {
    for (const record of this.runtimes.values()) {
      this.disposeRecord(record);
    }
    this.runtimes.clear();
    this.pendingMountedViews.clear();
  }

  private createWorkerRecord(
    snapshot: ScriptEntitySnapshot,
    localState?: Record<string, any>,
    mountedViewKeysRaw?: Iterable<string>,
  ) {
    const worker = new Worker(new URL('./worker.ts', import.meta.url), {
      type: 'module',
    });

    const record: RuntimeRecord = {
      snapshot: cloneJson(snapshot),
      descriptorKey: buildDescriptorKey(snapshot),
      localState: cloneJson(localState || {}),
      viewModel: {},
      mountedViewKeys: new Set(Array.from(mountedViewKeysRaw || [])),
      alive: true,
      worker,
    };

    worker.onmessage = (event: MessageEvent<any>) => {
      if (!record.alive) return;
      const message = event.data || {};
      if (message.type === 'view_model') {
        record.viewModel = cloneJson(message.payload?.viewModel || {});
        this.options.onViewModel(record.snapshot.nodeType, record.snapshot.nodeId, record.viewModel);
        return;
      }

      if (message.type === 'local_state') {
        record.localState = cloneJson(message.payload?.state || {});
        return;
      }

      if (message.type === 'runtime_error') {
        const errorMessage = String(message.payload?.message || 'script_runtime_error');
        this.options.onError?.(record.snapshot.nodeType, record.snapshot.nodeId, errorMessage);
        return;
      }

      if (message.type === 'request_runtime_action') {
        const actionType = String(message.payload?.actionType || '').trim();
        if (!actionType) return;

        void this.options.requestRuntimeAction(record.snapshot, {
          actionType,
          payload: cloneJson(message.payload?.payload),
        }).then((response) => {
          if (!record.alive) return;
          if (!response?.ok) {
            this.emitRuntimeEvent(record, 'server', 'runtime_action_error');
            return;
          }
          if (response.data && typeof response.data === 'object') {
            record.snapshot = withRuntimeData(record.snapshot, response.data);
            this.postToWorker(record, {
              type: 'runtime_data',
              payload: {
                data: cloneJson(record.snapshot.data || {}),
              },
            });
          }
        }).catch(() => {
          this.emitRuntimeEvent(record, 'server', 'runtime_action_error');
        });
      }
    };

    this.postToWorker(record, {
      type: 'init',
      payload: {
        snapshot: cloneJson(snapshot),
        localState: cloneJson(record.localState),
      },
    });

    if (record.mountedViewKeys.size > 0) {
      this.emitRuntimeEvent(record, 'system', 'lifecycle:mount', {
        reason: 'runtime_init_with_active_view',
        viewCount: record.mountedViewKeys.size,
      });
    }

    return record;
  }

  private ensureRuntime(snapshot: ScriptEntitySnapshot) {
    const entityKey = buildEntityKey(snapshot.nodeType, snapshot.nodeId);
    const descriptorKey = buildDescriptorKey(snapshot);
    const existing = this.runtimes.get(entityKey);
    if (!existing) {
      this.runtimes.set(entityKey, this.createWorkerRecord(
        snapshot,
        undefined,
        this.pendingMountedViews.get(entityKey),
      ));
      return;
    }

    if (existing.descriptorKey !== descriptorKey) {
      const previousLocalState = cloneJson(existing.localState || {});
      const mountedViewKeys = new Set([
        ...Array.from(existing.mountedViewKeys),
        ...Array.from(this.pendingMountedViews.get(entityKey) || []),
      ]);
      this.disposeRecord(existing);
      this.runtimes.set(entityKey, this.createWorkerRecord(snapshot, previousLocalState, mountedViewKeys));
      return;
    }

    existing.snapshot = cloneJson(snapshot);
    this.postToWorker(existing, {
      type: 'runtime_data',
      payload: {
        data: cloneJson(snapshot.data || {}),
      },
    });
  }

  private dropRuntime(nodeType: 'message' | 'room', nodeId: number) {
    const entityKey = buildEntityKey(nodeType, nodeId);
    const record = this.runtimes.get(entityKey);
    if (!record) return;
    this.disposeRecord(record);
    this.runtimes.delete(entityKey);
  }

  private snapshotFromRaw(nodeType: 'message' | 'room', raw: any): ScriptEntitySnapshot | null {
    const runtimeRaw = raw?.runtime && typeof raw.runtime === 'object' && !Array.isArray(raw.runtime)
      ? raw.runtime
      : raw;

    const nodeId = Number(raw?.nodeId || raw?.id || 0);
    const roomId = Number(raw?.roomId || 0);
    const clientScript = runtimeRaw?.clientScript ? String(runtimeRaw.clientScript).trim().toLowerCase() : null;
    const serverScript = runtimeRaw?.serverScript ? String(runtimeRaw.serverScript).trim().toLowerCase() : null;

    if (!Number.isFinite(nodeId) || nodeId <= 0) return null;
    if (!Number.isFinite(roomId) || roomId <= 0) return null;
    if (!clientScript && !serverScript) return null;

    const data = runtimeRaw?.data && typeof runtimeRaw.data === 'object' && !Array.isArray(runtimeRaw.data)
      ? cloneJson(runtimeRaw.data)
      : {};

    const snapshot: ScriptEntitySnapshot = {
      nodeType,
      nodeId,
      roomId,
      clientScript,
      serverScript,
      data,
    };

    return isSnapshotScriptable(snapshot) ? snapshot : null;
  }

  syncMessageRuntimes(messagesRaw: any[], activeRoomIdRaw: unknown) {
    const activeRoomId = Number(activeRoomIdRaw || 0);
    const keepKeys = new Set<string>();

    messagesRaw.forEach((message) => {
      const snapshot = this.snapshotFromRaw('message', message);
      if (!snapshot) return;
      if (snapshot.roomId !== activeRoomId) return;
      const key = buildEntityKey('message', snapshot.nodeId);
      keepKeys.add(key);
      this.ensureRuntime(snapshot);
    });

    for (const [key, runtime] of this.runtimes.entries()) {
      if (runtime.snapshot.nodeType !== 'message') continue;
      if (runtime.snapshot.roomId !== activeRoomId) {
        this.dropRuntime('message', runtime.snapshot.nodeId);
        continue;
      }
      if (!keepKeys.has(key)) {
        this.dropRuntime('message', runtime.snapshot.nodeId);
      }
    }
  }

  syncRoomRuntime(roomRuntimeRaw: any | null, activeRoomIdRaw: unknown) {
    const activeRoomId = Number(activeRoomIdRaw || 0);
    if (!Number.isFinite(activeRoomId) || activeRoomId <= 0) {
      for (const runtime of this.runtimes.values()) {
        if (runtime.snapshot.nodeType !== 'room') continue;
        this.dropRuntime('room', runtime.snapshot.nodeId);
      }
      return;
    }

    const snapshot = roomRuntimeRaw
      ? this.snapshotFromRaw('room', roomRuntimeRaw)
      : null;
    const existingRoomRuntimes = [...this.runtimes.values()].filter((runtime) => runtime.snapshot.nodeType === 'room');

    if (!snapshot) {
      existingRoomRuntimes.forEach((runtime) => this.dropRuntime('room', runtime.snapshot.nodeId));
      this.options.onViewModel('room', activeRoomId, {});
      return;
    }

    this.ensureRuntime(snapshot);
    existingRoomRuntimes.forEach((runtime) => {
      if (runtime.snapshot.nodeId === snapshot.nodeId) return;
      this.dropRuntime('room', runtime.snapshot.nodeId);
    });
  }

  sendUserAction(nodeType: 'message' | 'room', nodeId: number, actionType: string, payload?: any) {
    const key = buildEntityKey(nodeType, nodeId);
    const runtime = this.runtimes.get(key);
    if (!runtime) return;

    this.postToWorker(runtime, {
      type: 'user_action',
      payload: {
        actionType,
        payload: cloneJson(payload),
      },
    });
  }

  attachRuntimeView(
    nodeType: 'message' | 'room',
    nodeIdRaw: unknown,
    viewSourceRaw: unknown,
    viewInstanceIdRaw?: unknown,
  ) {
    const nodeId = Number(nodeIdRaw || 0);
    if (!Number.isFinite(nodeId) || nodeId <= 0) return;

    const viewKey = buildViewKey(viewSourceRaw, viewInstanceIdRaw);
    const runtime = this.runtimes.get(buildEntityKey(nodeType, nodeId));
    const entityKey = buildEntityKey(nodeType, nodeId);
    const pendingSet = this.pendingMountedViews.get(entityKey) || new Set<string>();
    pendingSet.add(viewKey);
    this.pendingMountedViews.set(entityKey, pendingSet);
    if (!runtime) return;

    const before = runtime.mountedViewKeys.size;
    runtime.mountedViewKeys.add(viewKey);
    if (before > 0 || runtime.mountedViewKeys.size <= 0) return;

    this.emitRuntimeEvent(runtime, 'system', 'lifecycle:mount', {
      viewSource: normalizeViewSource(viewSourceRaw),
      viewCount: runtime.mountedViewKeys.size,
    });
  }

  detachRuntimeView(
    nodeType: 'message' | 'room',
    nodeIdRaw: unknown,
    viewSourceRaw: unknown,
    viewInstanceIdRaw?: unknown,
  ) {
    const nodeId = Number(nodeIdRaw || 0);
    if (!Number.isFinite(nodeId) || nodeId <= 0) return;

    const runtime = this.runtimes.get(buildEntityKey(nodeType, nodeId));
    const entityKey = buildEntityKey(nodeType, nodeId);
    const viewKey = buildViewKey(viewSourceRaw, viewInstanceIdRaw);
    const pendingSet = this.pendingMountedViews.get(entityKey);
    if (pendingSet) {
      pendingSet.delete(viewKey);
      if (pendingSet.size <= 0) {
        this.pendingMountedViews.delete(entityKey);
      }
    }
    if (!runtime) return;

    if (!runtime.mountedViewKeys.delete(viewKey)) return;
    if (runtime.mountedViewKeys.size > 0) return;

    this.emitRuntimeEvent(runtime, 'system', 'lifecycle:unmount', {
      viewSource: normalizeViewSource(viewSourceRaw),
      viewCount: 0,
    });
  }

  pushRuntimeDataUpdate(payload: any) {
    const nodeType = String(payload?.nodeType || '').trim().toLowerCase();
    const nodeId = Number(payload?.nodeId || 0);
    if ((nodeType !== 'message' && nodeType !== 'room') || !Number.isFinite(nodeId) || nodeId <= 0) {
      return;
    }

    const runtime = this.runtimes.get(buildEntityKey(nodeType as 'message' | 'room', nodeId));
    if (!runtime) return;

    const nextSnapshot: ScriptEntitySnapshot = {
      ...runtime.snapshot,
      clientScript: payload?.clientScript ? String(payload.clientScript).trim().toLowerCase() : runtime.snapshot.clientScript,
      serverScript: payload?.serverScript ? String(payload.serverScript).trim().toLowerCase() : runtime.snapshot.serverScript,
      data: payload?.data && typeof payload.data === 'object' && !Array.isArray(payload.data)
        ? cloneJson(payload.data)
        : cloneJson(runtime.snapshot.data || {}),
    };
    runtime.snapshot = nextSnapshot;

    if (!isSnapshotScriptable(runtime.snapshot)) {
      this.dropRuntime(runtime.snapshot.nodeType, runtime.snapshot.nodeId);
      return;
    }

    const nextDescriptor = buildDescriptorKey(runtime.snapshot);
    if (nextDescriptor !== runtime.descriptorKey) {
      const localState = cloneJson(runtime.localState || {});
      const mountedViewKeys = new Set(runtime.mountedViewKeys);
      const entityKey = buildEntityKey(runtime.snapshot.nodeType, runtime.snapshot.nodeId);
      this.disposeRecord(runtime);
      this.runtimes.delete(entityKey);
      this.runtimes.set(
        entityKey,
        this.createWorkerRecord(runtime.snapshot, localState, mountedViewKeys),
      );
      return;
    }

    this.postToWorker(runtime, {
      type: 'runtime_data',
      payload: {
        data: cloneJson(runtime.snapshot.data || {}),
      },
    });
  }

  emitRoomHostEvent(roomIdRaw: unknown, eventTypeRaw: unknown, payload?: any, sourceRaw: unknown = 'room') {
    const roomId = Number(roomIdRaw || 0);
    if (!Number.isFinite(roomId) || roomId <= 0) return;

    const eventType = String(eventTypeRaw || '').trim();
    if (!eventType) return;
    const source = normalizeEventSource(sourceRaw, 'room');

    for (const runtime of this.runtimes.values()) {
      if (runtime.snapshot.roomId !== roomId) continue;
      this.emitRuntimeEvent(runtime, source, eventType, payload);
    }
  }
}
