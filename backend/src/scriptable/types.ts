export type ScriptNodeType = 'message' | 'room';

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
  data: any;
};

export type ScriptSideEffect = {
  type: 'system_message';
  text: string;
};

export type ScriptActionResult = {
  nextData: any;
  sideEffects?: ScriptSideEffect[];
};

export type ScriptDefinition = {
  scriptId: string;
  nodeType: ScriptNodeType;
  clientScript: string | null;
  serverScript: string | null;
  createData?: (input?: any) => any;
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
