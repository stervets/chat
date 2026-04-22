import type {ScriptEntitySnapshot} from '@/composables/types';

export type ScriptRuntimeEventSource = 'ui' | 'room' | 'server' | 'system';

export type ScriptRuntimeEvent = {
  source: ScriptRuntimeEventSource;
  type: string;
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
  onEvent?: (event: ScriptRuntimeEvent) => void;
  onDispose?: () => void;
};

export type ScriptWorkerFactory = {
  scriptId: string;
  revision: number;
  entityType: 'message' | 'room';
  create: (api: ScriptWorkerApi) => ScriptWorkerInstance;
};
