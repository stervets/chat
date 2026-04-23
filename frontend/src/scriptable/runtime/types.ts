import type {ScriptEntitySnapshot} from '@/composables/types';

export type ScriptRuntimeEventSource = 'ui' | 'room' | 'server' | 'system';

export type ScriptRuntimeEvent = {
  source: ScriptRuntimeEventSource;
  type: string;
  payload?: any;
};

export type ScriptWorkerApi = {
  getSnapshot: () => ScriptEntitySnapshot;
  getData: () => Record<string, any>;
  getLocalState: () => Record<string, any>;
  setLocalState: (next: Record<string, any>) => void;
  setViewModel: (viewModel: Record<string, any>) => void;
  requestRuntimeAction: (actionType: string, payload?: any) => void;
};

export type ScriptWorkerInstance = {
  onInit?: () => void;
  onEvent?: (event: ScriptRuntimeEvent) => void;
  onDispose?: () => void;
};

export type ScriptWorkerFactory = {
  scriptId: string;
  nodeType: 'message' | 'room';
  create: (api: ScriptWorkerApi) => ScriptWorkerInstance;
};
