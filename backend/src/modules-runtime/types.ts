export type RuntimeModuleKind = 'game';

export type RuntimeModule = {
  key: string;
  kind: RuntimeModuleKind;
  title: string;
  enabled: boolean;
};

export type ModulePlayerKind = 'human' | 'bot';

export type ModulePlayer = {
  userId: number;
  seat: number;
  kind: ModulePlayerKind;
};

export type ModuleAction = {
  type: string;
  payload?: unknown;
};

export type ModuleEvent = {
  type: string;
  payload?: unknown;
};

export type GameModule = RuntimeModule & {
  minPlayers: number;
  maxPlayers: number;
  supportsBots: boolean;

  createInitialState(input: {
    sessionId: number;
    players: ModulePlayer[];
    settings: Record<string, unknown>;
  }): unknown;

  getPublicState(input: {
    state: unknown;
    forUserId: number;
  }): unknown;

  listActions(input: {
    state: unknown;
    forUserId: number;
  }): ModuleAction[];

  applyAction(input: {
    state: unknown;
    actorUserId: number;
    action: ModuleAction;
    nowIso: string;
  }): {
    nextState: unknown;
    events: ModuleEvent[];
  };

  runBotTurn?(input: {
    state: unknown;
    actorUserId: number;
    nowIso: string;
  }): Promise<ModuleAction>;
};
