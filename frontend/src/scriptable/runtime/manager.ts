import type {ScriptEntitySnapshot, ScriptExecutionMode} from '@/composables/types';
import type {ScriptRuntimeEventSource} from './types';

type SharedActionRequest = {
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
  onViewModel: (entityType: 'message' | 'room', entityId: number, viewModel: Record<string, any>) => void;
  onError?: (entityType: 'message' | 'room', entityId: number, errorMessage: string) => void;
  requestSharedAction: (snapshot: ScriptEntitySnapshot, request: SharedActionRequest) => Promise<{
    ok: boolean;
    state?: Record<string, any>;
  }>;
};

function cloneJson<T>(value: T): T {
  try {
    return JSON.parse(JSON.stringify(value)) as T;
  } catch {
    return value;
  }
}

function normalizeMode(raw: unknown): ScriptExecutionMode | null {
  const mode = String(raw || '').trim().toLowerCase();
  if (mode === 'client' || mode === 'client_server' || mode === 'client_runner') {
    return mode;
  }
  return null;
}

function buildEntityKey(entityType: 'message' | 'room', entityId: number) {
  return `${entityType}:${entityId}`;
}

function buildDescriptorKey(snapshot: ScriptEntitySnapshot) {
  return [
    snapshot.entityType,
    snapshot.entityId,
    snapshot.scriptId,
    snapshot.scriptRevision,
    snapshot.scriptMode,
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
        this.options.onViewModel(record.snapshot.entityType, record.snapshot.entityId, record.viewModel);
        return;
      }

      if (message.type === 'local_state') {
        record.localState = cloneJson(message.payload?.state || {});
        return;
      }

      if (message.type === 'runtime_error') {
        const errorMessage = String(message.payload?.message || 'script_runtime_error');
        this.options.onError?.(record.snapshot.entityType, record.snapshot.entityId, errorMessage);
        return;
      }

      if (message.type === 'request_shared_action') {
        const actionType = String(message.payload?.actionType || '').trim();
        if (!actionType) return;

        void this.options.requestSharedAction(record.snapshot, {
          actionType,
          payload: cloneJson(message.payload?.payload),
        }).then((response) => {
          if (!record.alive) return;
          if (!response?.ok) {
            this.emitRuntimeEvent(record, 'server', 'shared_action_error');
            return;
          }
          if (response.state && typeof response.state === 'object') {
            record.snapshot.scriptStateJson = cloneJson(response.state);
            this.postToWorker(record, {
              type: 'shared_state',
              payload: {
                state: cloneJson(response.state),
              },
            });
          }
        }).catch(() => {
          this.emitRuntimeEvent(record, 'server', 'shared_action_error');
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
    const entityKey = buildEntityKey(snapshot.entityType, snapshot.entityId);
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
      type: 'shared_state',
      payload: {
        state: cloneJson(snapshot.scriptStateJson || {}),
      },
    });
  }

  private dropRuntime(entityType: 'message' | 'room', entityId: number) {
    const entityKey = buildEntityKey(entityType, entityId);
    const record = this.runtimes.get(entityKey);
    if (!record) return;
    this.disposeRecord(record);
    this.runtimes.delete(entityKey);
  }

  private snapshotFromRaw(entityType: 'message' | 'room', raw: any): ScriptEntitySnapshot | null {
    const scriptId = String(raw?.scriptId || '').trim().toLowerCase();
    const scriptRevision = Number.parseInt(String(raw?.scriptRevision ?? ''), 10);
    const scriptMode = normalizeMode(raw?.scriptMode);
    const entityId = Number(raw?.entityId || raw?.id || 0);
    const roomId = Number(raw?.roomId || 0);

    if (!scriptId || !scriptMode) return null;
    if (!Number.isFinite(scriptRevision) || scriptRevision <= 0) return null;
    if (!Number.isFinite(entityId) || entityId <= 0) return null;
    if (!Number.isFinite(roomId) || roomId <= 0) return null;

    const scriptConfigJson = raw?.scriptConfigJson && typeof raw.scriptConfigJson === 'object'
      ? cloneJson(raw.scriptConfigJson)
      : {};
    const scriptStateJson = raw?.scriptStateJson && typeof raw.scriptStateJson === 'object'
      ? cloneJson(raw.scriptStateJson)
      : {};

    return {
      entityType,
      entityId,
      roomId,
      scriptId,
      scriptRevision,
      scriptMode,
      scriptConfigJson,
      scriptStateJson,
    };
  }

  syncMessageRuntimes(messagesRaw: any[], activeRoomIdRaw: unknown) {
    const activeRoomId = Number(activeRoomIdRaw || 0);
    const keepKeys = new Set<string>();

    messagesRaw.forEach((message) => {
      const snapshot = this.snapshotFromRaw('message', message);
      if (!snapshot) return;
      if (snapshot.roomId !== activeRoomId) return;
      const key = buildEntityKey('message', snapshot.entityId);
      keepKeys.add(key);
      this.ensureRuntime(snapshot);
    });

    for (const [key, runtime] of this.runtimes.entries()) {
      if (runtime.snapshot.entityType !== 'message') continue;
      if (runtime.snapshot.roomId !== activeRoomId) {
        this.dropRuntime('message', runtime.snapshot.entityId);
        continue;
      }
      if (!keepKeys.has(key)) {
        this.dropRuntime('message', runtime.snapshot.entityId);
      }
    }
  }

  syncRoomRuntime(roomScriptRaw: any | null, activeRoomIdRaw: unknown) {
    const activeRoomId = Number(activeRoomIdRaw || 0);
    if (!Number.isFinite(activeRoomId) || activeRoomId <= 0) {
      for (const runtime of this.runtimes.values()) {
        if (runtime.snapshot.entityType !== 'room') continue;
        this.dropRuntime('room', runtime.snapshot.entityId);
      }
      return;
    }

    const snapshot = roomScriptRaw
      ? this.snapshotFromRaw('room', roomScriptRaw)
      : null;
    const existingRoomRuntimes = [...this.runtimes.values()].filter((runtime) => runtime.snapshot.entityType === 'room');

    if (!snapshot) {
      existingRoomRuntimes.forEach((runtime) => this.dropRuntime('room', runtime.snapshot.entityId));
      this.options.onViewModel('room', activeRoomId, {});
      return;
    }

    this.ensureRuntime(snapshot);
    existingRoomRuntimes.forEach((runtime) => {
      if (runtime.snapshot.entityId === snapshot.entityId) return;
      this.dropRuntime('room', runtime.snapshot.entityId);
    });
  }

  sendUserAction(entityType: 'message' | 'room', entityId: number, actionType: string, payload?: any) {
    const key = buildEntityKey(entityType, entityId);
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
    entityType: 'message' | 'room',
    entityIdRaw: unknown,
    viewSourceRaw: unknown,
    viewInstanceIdRaw?: unknown,
  ) {
    const entityId = Number(entityIdRaw || 0);
    if (!Number.isFinite(entityId) || entityId <= 0) return;

    const viewKey = buildViewKey(viewSourceRaw, viewInstanceIdRaw);
    const runtime = this.runtimes.get(buildEntityKey(entityType, entityId));
    const entityKey = buildEntityKey(entityType, entityId);
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
    entityType: 'message' | 'room',
    entityIdRaw: unknown,
    viewSourceRaw: unknown,
    viewInstanceIdRaw?: unknown,
  ) {
    const entityId = Number(entityIdRaw || 0);
    if (!Number.isFinite(entityId) || entityId <= 0) return;

    const runtime = this.runtimes.get(buildEntityKey(entityType, entityId));
    const entityKey = buildEntityKey(entityType, entityId);
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

  pushSharedStateUpdate(payload: any) {
    const entityType = String(payload?.entityType || '').trim().toLowerCase();
    const entityId = Number(payload?.entityId || 0);
    if ((entityType !== 'message' && entityType !== 'room') || !Number.isFinite(entityId) || entityId <= 0) {
      return;
    }

    const runtime = this.runtimes.get(buildEntityKey(entityType as 'message' | 'room', entityId));
    if (!runtime) return;

    runtime.snapshot.scriptStateJson = cloneJson(payload?.scriptStateJson || {});
    if (payload?.scriptRevision) {
      runtime.snapshot.scriptRevision = Number(payload.scriptRevision || runtime.snapshot.scriptRevision);
    }
    if (payload?.scriptMode) {
      const mode = normalizeMode(payload.scriptMode);
      if (mode) runtime.snapshot.scriptMode = mode;
    }

    const nextDescriptor = buildDescriptorKey(runtime.snapshot);
    if (nextDescriptor !== runtime.descriptorKey) {
      const localState = cloneJson(runtime.localState || {});
      const mountedViewKeys = new Set(runtime.mountedViewKeys);
      this.disposeRecord(runtime);
      this.runtimes.delete(buildEntityKey(runtime.snapshot.entityType, runtime.snapshot.entityId));
      this.runtimes.set(
        buildEntityKey(runtime.snapshot.entityType, runtime.snapshot.entityId),
        this.createWorkerRecord(runtime.snapshot, localState, mountedViewKeys),
      );
      return;
    }

    this.postToWorker(runtime, {
      type: 'shared_state',
      payload: {
        state: cloneJson(runtime.snapshot.scriptStateJson || {}),
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
