import type {ScriptEntityType, ScriptExecutionMode, ScriptSideEffect} from './types.js';

export type RunnerRequest = {
  id: string;
  type: 'room_event' | 'entity_action';
  payload: {
    entityType: ScriptEntityType;
    entityId: number;
    roomId: number;
    scriptId: string;
    scriptRevision: number;
    scriptMode: ScriptExecutionMode;
    scriptConfigJson: any;
    scriptStateJson: any;
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
