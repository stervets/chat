import type {ScriptNodeType, ScriptExecutionMode, ScriptSideEffect} from './types.js';

export type RunnerRequest = {
  id: string;
  type: 'room_event' | 'entity_action';
  payload: {
    nodeType: ScriptNodeType;
    nodeId: number;
    roomId: number;
    scriptId: string;
    runtimeRevision: number;
    runtimeMode: ScriptExecutionMode;
    config: any;
    state: any;
    actionType?: string;
    actionPayload?: any;
    actor?: {
      userId: number;
      nickname: string;
      name: string;
    };
    eventType?: string;
    eventPayload?: any;
  };
};

export type RunnerResponse = {
  id: string;
  ok: boolean;
  error?: string;
  state?: any;
  sideEffects?: ScriptSideEffect[];
};
