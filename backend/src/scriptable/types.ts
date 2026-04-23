export type ScriptNodeType = 'message' | 'room';
export type ScriptExecutionMode = 'client' | 'client_server' | 'client_runner';

export type ScriptActor = {
  userId: number;
  nickname: string;
  name: string;
};

export type ScriptActionInput = {
  nodeType: ScriptNodeType;
  nodeId: number;
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
  nodeType: ScriptNodeType;
  mode: ScriptExecutionMode;
  title: string;
  makeInitialConfig?: (input?: any) => any;
  makeInitialState?: (input?: {config: any}) => any;
  reduceAction?: (input: ScriptActionInput) => ScriptActionResult | Promise<ScriptActionResult>;
};

export type ScriptStateEventPayload = {
  roomId: number;
  nodeType: ScriptNodeType;
  nodeId: number;
  clientScript: string | null;
  serverScript: string | null;
  data: any;
};
