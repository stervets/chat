import {DEFAULT_NICKNAME_COLOR} from '../common/const.js';
import {db} from '../db.js';
import {getRoomById, userCanAccessRoom} from '../common/rooms.js';
import {
  createMessageNode,
  mergeNodeData,
  readNodeRuntime,
  readNodeScriptConfigData,
  readNodeScriptId,
  readNodeScriptStateData,
} from '../common/nodes.js';
import {scriptableEvents} from './events.js';
import {getLatestScriptDefinition, getScriptDefinition} from './registry.js';
import {scriptRunnerClient} from './runner-client.js';
import type {
  ScriptActionResult,
  ScriptExecutionMode,
  ScriptNodeType,
} from './types.js';
import {ChatContext, type ApiError, type ApiOk, type ChatContextMessagePayload} from '../ws/chat/chat-context.js';

type ScriptedMessageRow = {
  id: number;
  roomId: number;
  kind: 'text' | 'system' | 'scriptable';
  clientScript: string | null;
  serverScript: string | null;
  nodeData: any;
  scriptId: string | null;
  config: any;
  state: any;
};

type ScriptedRoomRow = {
  id: number;
  kind: 'group' | 'direct' | 'game' | 'comment';
  clientScript: string | null;
  serverScript: string | null;
  nodeData: any;
  scriptId: string | null;
  config: any;
  state: any;
};

function cloneJson<T>(value: T): T {
  try {
    return JSON.parse(JSON.stringify(value)) as T;
  } catch {
    return value;
  }
}

function scriptFallbackText(scriptId: string, revision: number) {
  return `[script:${scriptId}@${revision}]`;
}

function scriptFallbackHtml(scriptId: string, revision: number) {
  const escapedId = scriptId
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
  return `<span class="scriptable-fallback">script ${escapedId}@${revision}</span>`;
}

function pickNodeScripts(scriptId: string, mode: ScriptExecutionMode) {
  if (mode === 'client_server') {
    return {
      clientScript: scriptId,
      serverScript: scriptId,
    };
  }
  return {
    clientScript: scriptId,
    serverScript: null,
  };
}

function hasNodeRuntime(node: {clientScript?: unknown; serverScript?: unknown} | null | undefined) {
  return !!String(node?.clientScript || '').trim() || !!String(node?.serverScript || '').trim();
}

export class ScriptableService {
  constructor(private readonly ctx: ChatContext) {}

  startRunnerClient() {
    scriptRunnerClient.start();
  }

  stopRunnerClient() {
    scriptRunnerClient.stop();
  }

  private toScriptStatePayload(input: {
    roomId: number;
    nodeType: ScriptNodeType;
    nodeId: number;
    clientScript: string | null;
    serverScript: string | null;
    data: any;
  }) {
    return {
      roomId: input.roomId,
      nodeType: input.nodeType,
      nodeId: input.nodeId,
      clientScript: input.clientScript,
      serverScript: input.serverScript,
      data: cloneJson(input.data || {}),
    };
  }

  private async createSystemMessage(roomId: number, textRaw: unknown) {
    const rawText = String(textRaw || '').trim();
    if (!rawText) return null;

    const systemUserId = await this.ctx.findSystemUserId();
    if (!systemUserId) return null;

    const sender = await db.user.findUnique({
      where: {id: systemUserId},
      select: {
        id: true,
        nickname: true,
        name: true,
        nicknameColor: true,
        donationBadgeUntil: true,
      },
    });
    if (!sender) return null;

    const compiled = await this.ctx.compileMessageForRoom(roomId, rawText);
    const created = await createMessageNode(db, {
      roomId,
      senderId: sender.id,
      createdById: sender.id,
      kind: 'system',
      rawText: compiled.rawText,
      renderedHtml: compiled.renderedHtml,
    });

    const payload: ChatContextMessagePayload = {
      id: created.message.id,
      roomId,
      dialogId: roomId,
      kind: 'system',
      authorId: sender.id,
      authorNickname: sender.nickname,
      authorName: sender.name || sender.nickname,
      authorNicknameColor: sender.nicknameColor || DEFAULT_NICKNAME_COLOR,
      authorDonationBadgeUntil: this.ctx.normalizeDonationBadgeUntil(sender.donationBadgeUntil),
      rawText: compiled.rawText,
      renderedHtml: compiled.renderedHtml,
      renderedPreviews: compiled.renderedPreviews,
      runtime: {
        clientScript: null,
        serverScript: null,
        data: {},
      },
      createdAt: created.message.createdAt.toISOString(),
      reactions: [],
    };

    return payload;
  }

  private async emitSideEffects(roomId: number, sideEffectsRaw: unknown) {
    const sideEffects = Array.isArray(sideEffectsRaw) ? sideEffectsRaw : [];
    for (const sideEffect of sideEffects) {
      if (String(sideEffect?.type || '') !== 'system_message') continue;
      const payload = await this.createSystemMessage(roomId, sideEffect?.text);
      if (payload) {
        scriptableEvents.emit('scripts:message', payload);
      }
    }
  }

  private normalizeConfig(raw: unknown) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return {};
    }
    return cloneJson(raw);
  }

  async createScriptableMessage(
    state: any,
    roomIdRaw: unknown,
    payloadRaw: any,
  ): Promise<ApiError | ApiOk<{message: ChatContextMessagePayload}>> {
    const authError = this.ctx.requireAuth(state);
    if (authError) return authError;

    const roomId = this.ctx.parseRoomId(roomIdRaw);
    if (!roomId) {
      return {ok: false, error: 'invalid_room'};
    }

    const room = await getRoomById(roomId);
    if (!room || !userCanAccessRoom(state.user!.id, room)) {
      return {ok: false, error: 'forbidden'};
    }

    const scriptId = String(payloadRaw?.scriptId || '').trim().toLowerCase();
    if (!scriptId) {
      return {ok: false, error: 'script_id_required'};
    }

    const definition = getLatestScriptDefinition('message', scriptId);
    if (!definition) {
      return {ok: false, error: 'script_not_found'};
    }

    const initialConfig = definition.makeInitialConfig
      ? definition.makeInitialConfig(this.normalizeConfig(payloadRaw?.config))
      : this.normalizeConfig(payloadRaw?.config);
    const initialState = definition.makeInitialState
      ? definition.makeInitialState({config: initialConfig})
      : {};
    const fallbackText = scriptFallbackText(definition.scriptId, definition.revision);
    const fallbackHtml = scriptFallbackHtml(definition.scriptId, definition.revision);
    const nodeScripts = pickNodeScripts(definition.scriptId, definition.mode);
    const nodeData = mergeNodeData({
      current: {},
      scriptConfig: cloneJson(initialConfig || {}),
      scriptState: cloneJson(initialState || {}),
    });

    const created = await createMessageNode(db, {
      roomId,
      senderId: state.user!.id,
      createdById: state.user!.id,
      kind: 'scriptable',
      rawText: fallbackText,
      renderedHtml: fallbackHtml,
      clientScript: nodeScripts.clientScript,
      serverScript: nodeScripts.serverScript,
      nodeData,
    });

    await this.ctx.pruneRoomOverflow(roomId);

    const message: ChatContextMessagePayload = {
      id: created.message.id,
      roomId,
      dialogId: roomId,
      kind: 'scriptable',
      authorId: state.user!.id,
      authorNickname: state.user!.nickname,
      authorName: state.user!.name,
      authorNicknameColor: state.user!.nicknameColor,
      authorDonationBadgeUntil: state.user!.donationBadgeUntil,
      rawText: fallbackText,
      renderedHtml: fallbackHtml,
      renderedPreviews: [],
      runtime: {
        clientScript: nodeScripts.clientScript,
        serverScript: nodeScripts.serverScript,
        data: cloneJson(nodeData || {}),
      },
      createdAt: created.message.createdAt.toISOString(),
      reactions: [],
    };

    return {
      ok: true,
      message,
    };
  }

  private async loadScriptedMessage(messageId: number): Promise<ScriptedMessageRow | null> {
    const row = await db.message.findUnique({
      where: {id: messageId},
      select: {
        id: true,
        kind: true,
        node: {
          select: {
            parentId: true,
            clientScript: true,
            serverScript: true,
            data: true,
          },
        },
      },
    });
    if (!row) return null;

    const roomId = Number(row.node?.parentId || 0);
    if (!Number.isFinite(roomId) || roomId <= 0) return null;

    return {
      id: row.id,
      roomId,
      kind: row.kind === 'system' || row.kind === 'scriptable' ? row.kind : 'text',
      clientScript: row.node?.clientScript || null,
      serverScript: row.node?.serverScript || null,
      nodeData: cloneJson(row.node?.data || {}),
      scriptId: readNodeScriptId(row.node),
      config: readNodeScriptConfigData(row.node),
      state: readNodeScriptStateData(row.node),
    };
  }

  private async loadScriptedRoom(roomId: number): Promise<ScriptedRoomRow | null> {
    const row = await db.room.findUnique({
      where: {id: roomId},
      select: {
        id: true,
        kind: true,
        node: {
          select: {
            clientScript: true,
            serverScript: true,
            data: true,
          },
        },
      },
    });
    if (!row) return null;

    return {
      id: row.id,
      kind: row.kind === 'direct' || row.kind === 'game' || row.kind === 'comment' ? row.kind : 'group',
      clientScript: row.node?.clientScript || null,
      serverScript: row.node?.serverScript || null,
      nodeData: cloneJson(row.node?.data || {}),
      scriptId: readNodeScriptId(row.node),
      config: readNodeScriptConfigData(row.node),
      state: readNodeScriptStateData(row.node),
    };
  }

  async getRoomScriptEntity(
    state: any,
    roomIdRaw: unknown,
  ): Promise<ApiError | ApiOk<{roomId: number; roomRuntime: any | null}>> {
    const authError = this.ctx.requireAuth(state);
    if (authError) return authError;

    const roomId = this.ctx.parseRoomId(roomIdRaw);
    if (!roomId) {
      return {ok: false, error: 'invalid_room'};
    }

    const room = await getRoomById(roomId);
    if (!room || !userCanAccessRoom(state.user!.id, room)) {
      return {ok: false, error: 'forbidden'};
    }

    const scriptedRoom = await this.loadScriptedRoom(roomId);
    if (!scriptedRoom || !scriptedRoom.scriptId || !hasNodeRuntime(scriptedRoom)) {
      return {
        ok: true,
        roomId,
        roomRuntime: null,
      };
    }

    return {
      ok: true,
      roomId,
      roomRuntime: {
        nodeType: 'room',
        nodeId: scriptedRoom.id,
        roomId,
        clientScript: scriptedRoom.clientScript,
        serverScript: scriptedRoom.serverScript,
        data: cloneJson(scriptedRoom.nodeData || {}),
      },
    };
  }

  private async saveNodeScriptState(nodeId: number, nodeData: any, nextState: any) {
    await db.node.update({
      where: {id: nodeId},
      data: {
        data: mergeNodeData({
          current: nodeData || {},
          scriptState: nextState,
        }),
      },
    });
  }

  private resolveRuntimeDefinition(nodeType: ScriptNodeType, scriptIdRaw: unknown) {
    const scriptId = String(scriptIdRaw || '').trim().toLowerCase();
    if (!scriptId) return null;
    const definition = getLatestScriptDefinition(nodeType, scriptId);
    if (!definition) return null;
    return {
      scriptId: definition.scriptId,
      runtimeRevision: definition.revision,
      runtimeMode: definition.mode,
    };
  }

  private async applyClientServerAction(input: {
    nodeType: ScriptNodeType;
    nodeId: number;
    roomId: number;
    scriptId: string;
    runtimeRevision: number;
    runtimeMode: ScriptExecutionMode;
    clientScript: string | null;
    serverScript: string | null;
    config: any;
    state: any;
    nodeData: any;
    actionType: string;
    actionPayload: any;
    actor: {
      userId: number;
      nickname: string;
      name: string;
    };
  }) {
    const definition = getScriptDefinition(input.nodeType, input.scriptId, input.runtimeRevision);
    if (!definition || !definition.reduceAction) {
      return {ok: false, error: 'script_action_not_supported'};
    }

    const actionResult = await definition.reduceAction({
      nodeType: input.nodeType,
      nodeId: input.nodeId,
      roomId: input.roomId,
      actionType: input.actionType,
      payload: input.actionPayload,
      actor: input.actor,
      config: cloneJson(input.config || {}),
      state: cloneJson(input.state || {}),
    });
    const nextState = cloneJson(actionResult?.nextState || {});

    await this.saveNodeScriptState(input.nodeId, input.nodeData, nextState);

    scriptableEvents.emit('scripts:state', this.toScriptStatePayload({
      roomId: input.roomId,
      nodeType: input.nodeType,
      nodeId: input.nodeId,
      clientScript: input.clientScript,
      serverScript: input.serverScript,
      data: mergeNodeData({
        current: input.nodeData || {},
        scriptState: nextState,
      }),
    }));

    await this.emitSideEffects(input.roomId, actionResult?.sideEffects);

    return {
      ok: true,
      state: nextState,
    };
  }

  private async applyRunnerAction(input: {
    nodeType: ScriptNodeType;
    nodeId: number;
    roomId: number;
    scriptId: string;
    runtimeRevision: number;
    runtimeMode: ScriptExecutionMode;
    clientScript: string | null;
    serverScript: string | null;
    config: any;
    state: any;
    nodeData: any;
    actionType: string;
    actionPayload: any;
    actor: {
      userId: number;
      nickname: string;
      name: string;
    };
  }) {
    const response = await scriptRunnerClient.request({
      nodeType: input.nodeType,
      nodeId: input.nodeId,
      roomId: input.roomId,
      scriptId: input.scriptId,
      runtimeRevision: input.runtimeRevision,
      runtimeMode: input.runtimeMode,
      config: cloneJson(input.config || {}),
      state: cloneJson(input.state || {}),
      actionType: input.actionType,
      actionPayload: cloneJson(input.actionPayload),
      actor: input.actor,
    }, 'entity_action');

    if (!response.ok) {
      return {ok: false, error: response.error || 'runner_action_failed'};
    }

    const nextState = cloneJson(response.state || {});

    await this.saveNodeScriptState(input.nodeId, input.nodeData, nextState);

    scriptableEvents.emit('scripts:state', this.toScriptStatePayload({
      roomId: input.roomId,
      nodeType: input.nodeType,
      nodeId: input.nodeId,
      clientScript: input.clientScript,
      serverScript: input.serverScript,
      data: mergeNodeData({
        current: input.nodeData || {},
        scriptState: nextState,
      }),
    }));

    await this.emitSideEffects(input.roomId, response.sideEffects);

    return {
      ok: true,
      state: nextState,
    };
  }

  async applyScriptAction(
    state: any,
    payloadRaw: any,
  ): Promise<ApiError | ApiOk<{roomId: number; nodeType: ScriptNodeType; nodeId: number; state: any}>> {
    const authError = this.ctx.requireAuth(state);
    if (authError) return authError;

    const nodeTypeRaw = String(payloadRaw?.nodeType || '').trim().toLowerCase();
    const nodeType: ScriptNodeType | null = nodeTypeRaw === 'message'
      ? 'message'
      : (nodeTypeRaw === 'room' ? 'room' : null);
    if (!nodeType) {
      return {ok: false, error: 'invalid_node_type'};
    }

    const nodeId = Number.parseInt(String(payloadRaw?.nodeId ?? ''), 10);
    if (!Number.isFinite(nodeId) || nodeId <= 0) {
      return {ok: false, error: 'invalid_node_id'};
    }

    const actionType = String(payloadRaw?.actionType || '').trim();
    if (!actionType) {
      return {ok: false, error: 'invalid_action_type'};
    }

    let roomId = 0;
    let scriptId = '';
    let runtimeScriptId = '';
    let runtimeRevision = 0;
    let runtimeMode: ScriptExecutionMode | null = null;
    let clientScript: string | null = null;
    let serverScript: string | null = null;
    let config: any = {};
    let currentState: any = {};
    let nodeData: any = {};

    if (nodeType === 'message') {
      const message = await this.loadScriptedMessage(nodeId);
      if (!message || message.kind !== 'scriptable') {
        return {ok: false, error: 'scriptable_message_not_found'};
      }
      roomId = message.roomId;
      runtimeScriptId = String(message.scriptId || '').trim().toLowerCase();
      clientScript = message.clientScript || null;
      serverScript = message.serverScript || null;
      config = cloneJson(message.config || {});
      currentState = cloneJson(message.state || {});
      nodeData = cloneJson(message.nodeData || {});
    } else {
      const room = await this.loadScriptedRoom(nodeId);
      if (!room) {
        return {ok: false, error: 'room_not_found'};
      }
      roomId = room.id;
      runtimeScriptId = String(room.scriptId || '').trim().toLowerCase();
      clientScript = room.clientScript || null;
      serverScript = room.serverScript || null;
      config = cloneJson(room.config || {});
      currentState = cloneJson(room.state || {});
      nodeData = cloneJson(room.nodeData || {});
    }

    const runtimeDefinition = this.resolveRuntimeDefinition(nodeType, runtimeScriptId);
    if (!runtimeDefinition) {
      return {ok: false, error: 'script_not_configured'};
    }
    scriptId = runtimeDefinition.scriptId;
    runtimeRevision = runtimeDefinition.runtimeRevision;
    runtimeMode = runtimeDefinition.runtimeMode;

    const room = await getRoomById(roomId);
    if (!room || !userCanAccessRoom(state.user!.id, room)) {
      return {ok: false, error: 'forbidden'};
    }

    if (runtimeMode === 'client') {
      return {ok: false, error: 'script_mode_client_only'};
    }

    const input = {
      nodeType: nodeType,
      nodeId: nodeId,
      roomId,
      scriptId,
      runtimeRevision,
      runtimeMode,
      clientScript,
      serverScript,
      config,
      state: currentState,
      nodeData,
      actionType,
      actionPayload: cloneJson(payloadRaw?.payload),
      actor: {
        userId: state.user!.id,
        nickname: state.user!.nickname,
        name: state.user!.name || state.user!.nickname,
      },
    };

    const result = runtimeMode === 'client_server'
      ? await this.applyClientServerAction(input)
      : await this.applyRunnerAction(input);
    if (!(result as any)?.ok) {
      return {ok: false, error: String((result as any)?.error || 'script_action_failed')};
    }

    return {
      ok: true,
      roomId,
      nodeType,
      nodeId,
      state: cloneJson((result as any).state || {}),
    };
  }

  async notifyRoomEvent(inputRaw: {
    roomId: number;
    eventType: string;
    eventPayload: any;
  }) {
    const roomId = Number(inputRaw.roomId || 0);
    if (!Number.isFinite(roomId) || roomId <= 0) return;

    const room = await this.loadScriptedRoom(roomId);
    if (!room || !room.scriptId) return;
    const runtimeDefinition = this.resolveRuntimeDefinition('room', room.scriptId);
    if (!runtimeDefinition) return;
    if (runtimeDefinition.runtimeMode !== 'client_runner') return;

    const response = await scriptRunnerClient.request({
      nodeType: 'room',
      nodeId: room.id,
      roomId: room.id,
      scriptId: runtimeDefinition.scriptId,
      runtimeRevision: runtimeDefinition.runtimeRevision,
      runtimeMode: runtimeDefinition.runtimeMode,
      config: cloneJson(room.config || {}),
      state: cloneJson(room.state || {}),
      eventType: String(inputRaw.eventType || '').trim() || 'room_event',
      eventPayload: cloneJson(inputRaw.eventPayload),
    }, 'room_event');

    if (!response.ok) {
      return;
    }

    const nextState = cloneJson(response.state || {});
    await this.saveNodeScriptState(room.id, room.nodeData, nextState);

    scriptableEvents.emit('scripts:state', this.toScriptStatePayload({
      roomId: room.id,
      nodeType: 'room',
      nodeId: room.id,
      clientScript: room.clientScript,
      serverScript: room.serverScript,
      data: mergeNodeData({
        current: room.nodeData || {},
        scriptState: nextState,
      }),
    }));

    await this.emitSideEffects(room.id, response.sideEffects);
  }

  async ensureDefaultGeneralRoomScript() {
    const generalRoom = await db.room.findFirst({
      where: {kind: 'group'},
      orderBy: {id: 'asc'},
      select: {
        id: true,
        node: {
          select: {
            clientScript: true,
            serverScript: true,
            data: true,
          },
        },
      },
    });
    if (!generalRoom) return;
    if (readNodeScriptId(generalRoom.node)) return;

    const definition = getLatestScriptDefinition('room', 'demo:room_meter');
    if (!definition) return;

    const initialConfig = definition.makeInitialConfig
      ? definition.makeInitialConfig({})
      : {};
    const initialState = definition.makeInitialState
      ? definition.makeInitialState({config: initialConfig})
      : {};
    const nodeScripts = pickNodeScripts(definition.scriptId, definition.mode);

    await db.node.update({
      where: {
        id: generalRoom.id,
      },
      data: {
        clientScript: nodeScripts.clientScript,
        serverScript: nodeScripts.serverScript,
        data: mergeNodeData({
          current: generalRoom.node?.data || {},
          scriptConfig: cloneJson(initialConfig || {}),
          scriptState: cloneJson(initialState || {}),
        }),
      },
    });
  }
}
