import type {ScriptEntitySnapshot} from '@/composables/types';

export type WorkerHostEvent = {
  eventType: string;
  payload?: any;
};

export type WorkerUserAction = {
  actionType: string;
  payload?: any;
};

export type ScriptWorkerApi = {
  getSnapshot: () => ScriptEntitySnapshot;
  getConfig: () => Record<string, any>;
  getSharedState: () => Record<string, any>;
  getLocalState: () => Record<string, any>;
  setLocalState: (next: Record<string, any>) => void;
  setViewModel: (viewModel: Record<string, any>) => void;
  requestSharedAction: (actionType: string, payload?: any) => void;
};

export type ScriptWorkerInstance = {
  onInit?: () => void;
  onUserAction?: (action: WorkerUserAction) => void;
  onSharedState?: (state: Record<string, any>) => void;
  onHostEvent?: (event: WorkerHostEvent) => void;
  onDispose?: () => void;
};

export type ScriptWorkerFactory = {
  scriptId: string;
  revision: number;
  entityType: 'message' | 'room';
  create: (api: ScriptWorkerApi) => ScriptWorkerInstance;
};
