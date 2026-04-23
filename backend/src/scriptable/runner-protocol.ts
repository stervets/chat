import type {ScriptNodeType, ScriptSideEffect} from './types.js';

export type RunnerRequest = {
  id: string;
  type: 'room_event' | 'entity_action';
  payload: {
    nodeType: ScriptNodeType;
    nodeId: number;
    roomId: number;
    clientScript: string | null;
    serverScript: string | null;
    data: any;
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
  data?: any;
  sideEffects?: ScriptSideEffect[];
};
