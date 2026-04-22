export type ScriptEntityType = 'message' | 'room';
export type ScriptExecutionMode = 'client' | 'client_server' | 'client_runner';

export type ScriptActor = {
  userId: number;
  nickname: string;
  name: string;
};

export type ScriptActionInput = {
  entityType: ScriptEntityType;
  entityId: number;
  roomId: number;
  actionType: string;
  payload: any;
  actor: ScriptActor;
  state: any;
  config: any;
};

export type ScriptSideEffect = {
  type: 'system_message';
  text: string;
};

export type ScriptActionResult = {
  nextState: any;
  sideEffects?: ScriptSideEffect[];
};

export type ScriptDefinition = {
  scriptId: string;
  revision: number;
  entityType: ScriptEntityType;
  mode: ScriptExecutionMode;
  title: string;
  makeInitialConfig?: (input?: any) => any;
  makeInitialState?: (input?: {config: any}) => any;
  reduceAction?: (input: ScriptActionInput) => ScriptActionResult | Promise<ScriptActionResult>;
};

export type ScriptStateEventPayload = {
  roomId: number;
  entityType: ScriptEntityType;
  entityId: number;
  scriptId: string;
  scriptRevision: number;
  scriptMode: ScriptExecutionMode;
  scriptStateJson: any;
};
