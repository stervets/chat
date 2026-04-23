import {DEFAULT_NICKNAME_COLOR} from '../common/const.js';
import {db} from '../db.js';
import {getRoomById, userCanAccessRoom} from '../common/rooms.js';
import {
  createMessageNode,
  mergeNodeData,
  readNodeRuntime,
} from '../common/nodes.js';
import {scriptableEvents} from './events.js';
import {getScriptDefinition} from './registry.js';
import {scriptRunnerClient} from './runner-client.js';
import type {ScriptNodeType} from './types.js';
import {ChatContext, type ApiError, type ApiOk, type ChatContextMessagePayload} from '../ws/chat/chat-context.js';

type ScriptedMessageRow = {
  id: number;
  roomId: number;
  kind: 'text' | 'system' | 'scriptable';
  runtime: {
    clientScript: string | null;
    serverScript: string | null;
    data: Record<string, any>;
  };
};

type ScriptedRoomRow = {
  id: number;
  kind: 'group' | 'direct' | 'game' | 'comment';
  runtime: {
    clientScript: string | null;
    serverScript: string | null;
    data: Record<string, any>;
  };
};

function cloneJson<T>(value: T): T {
  try {
    return JSON.parse(JSON.stringify(value)) as T;
  } catch {
    return value;
  }
}

function asRecord(raw: unknown) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  return cloneJson(raw as Record<string, any>);
}

function scriptFallbackText(scriptId: string) {
  return `[script:${scriptId}]`;
}

function scriptFallbackHtml(scriptId: string) {
  const escapedId = scriptId
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
  return `<span class="scriptable-fallback">script ${escapedId}</span>`;
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

    const definition = getScriptDefinition('message', scriptId);
    if (!definition) {
      return {ok: false, error: 'script_not_found'};
    }

    const nodeData = asRecord(definition.createData
      ? definition.createData(this.normalizeConfig(payloadRaw?.config))
      : {});
    const fallbackText = scriptFallbackText(definition.scriptId);
    const fallbackHtml = scriptFallbackHtml(definition.scriptId);

    const created = await createMessageNode(db, {
      roomId,
      senderId: state.user!.id,
      createdById: state.user!.id,
      kind: 'scriptable',
      rawText: fallbackText,
      renderedHtml: fallbackHtml,
      clientScript: definition.clientScript,
      serverScript: definition.serverScript,
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
        clientScript: definition.clientScript,
        serverScript: definition.serverScript,
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
      runtime: readNodeRuntime(row.node),
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
      runtime: readNodeRuntime(row.node),
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
    if (!scriptedRoom || (!scriptedRoom.runtime.clientScript && !scriptedRoom.runtime.serverScript)) {
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
        clientScript: scriptedRoom.runtime.clientScript,
        serverScript: scriptedRoom.runtime.serverScript,
        data: cloneJson(scriptedRoom.runtime.data || {}),
      },
    };
  }

  private async saveNodeRuntimeData(nodeId: number, nextData: any) {
    await db.node.update({
      where: {id: nodeId},
      data: {
        data: asRecord(nextData),
      },
    });
  }

  private async applyClientServerAction(input: {
    nodeType: ScriptNodeType;
    nodeId: number;
    roomId: number;
    clientScript: string | null;
    serverScript: string | null;
    data: any;
    actionType: string;
    actionPayload: any;
    actor: {
      userId: number;
      nickname: string;
      name: string;
    };
  }) {
    const definition = getScriptDefinition(input.nodeType, input.serverScript || input.clientScript || null);
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
      data: cloneJson(input.data || {}),
    });
    const nextData = asRecord(actionResult?.nextData);

    await this.saveNodeRuntimeData(input.nodeId, nextData);

    scriptableEvents.emit('scripts:state', this.toScriptStatePayload({
      roomId: input.roomId,
      nodeType: input.nodeType,
      nodeId: input.nodeId,
      clientScript: input.clientScript,
      serverScript: input.serverScript,
      data: nextData,
    }));

    await this.emitSideEffects(input.roomId, actionResult?.sideEffects);

    return {
      ok: true,
      data: nextData,
    };
  }

  private async applyRunnerAction(input: {
    nodeType: ScriptNodeType;
    nodeId: number;
    roomId: number;
    clientScript: string | null;
    serverScript: string | null;
    data: any;
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
      clientScript: input.clientScript,
      serverScript: input.serverScript,
      data: cloneJson(input.data || {}),
      actionType: input.actionType,
      actionPayload: cloneJson(input.actionPayload),
      actor: input.actor,
    }, 'entity_action');

    if (!response.ok) {
      return {ok: false, error: response.error || 'runner_action_failed'};
    }

    const nextData = asRecord(response.data);

    await this.saveNodeRuntimeData(input.nodeId, nextData);

    scriptableEvents.emit('scripts:state', this.toScriptStatePayload({
      roomId: input.roomId,
      nodeType: input.nodeType,
      nodeId: input.nodeId,
      clientScript: input.clientScript,
      serverScript: input.serverScript,
      data: nextData,
    }));

    await this.emitSideEffects(input.roomId, response.sideEffects);

    return {
      ok: true,
      data: nextData,
    };
  }

  async applyScriptAction(
    state: any,
    payloadRaw: any,
  ): Promise<ApiError | ApiOk<{roomId: number; nodeType: ScriptNodeType; nodeId: number; data: any}>> {
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
    let clientScript: string | null = null;
    let serverScript: string | null = null;
    let data: any = {};

    if (nodeType === 'message') {
      const message = await this.loadScriptedMessage(nodeId);
      if (!message || message.kind !== 'scriptable') {
        return {ok: false, error: 'scriptable_message_not_found'};
      }
      roomId = message.roomId;
      clientScript = message.runtime.clientScript || null;
      serverScript = message.runtime.serverScript || null;
      data = cloneJson(message.runtime.data || {});
    } else {
      const room = await this.loadScriptedRoom(nodeId);
      if (!room) {
        return {ok: false, error: 'room_not_found'};
      }
      roomId = room.id;
      clientScript = room.runtime.clientScript || null;
      serverScript = room.runtime.serverScript || null;
      data = cloneJson(room.runtime.data || {});
    }

    if (!serverScript) {
      return {ok: false, error: 'script_server_runtime_required'};
    }

    const room = await getRoomById(roomId);
    if (!room || !userCanAccessRoom(state.user!.id, room)) {
      return {ok: false, error: 'forbidden'};
    }

    const input = {
      nodeType: nodeType,
      nodeId: nodeId,
      roomId,
      clientScript,
      serverScript,
      data,
      actionType,
      actionPayload: cloneJson(payloadRaw?.payload),
      actor: {
        userId: state.user!.id,
        nickname: state.user!.nickname,
        name: state.user!.name || state.user!.nickname,
      },
    };

    const result = serverScript === clientScript
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
      data: cloneJson((result as any).data || {}),
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
    if (!room || !room.runtime.serverScript) return;
    if (room.runtime.clientScript) return;

    const response = await scriptRunnerClient.request({
      nodeType: 'room',
      nodeId: room.id,
      roomId: room.id,
      clientScript: room.runtime.clientScript,
      serverScript: room.runtime.serverScript,
      data: cloneJson(room.runtime.data || {}),
      eventType: String(inputRaw.eventType || '').trim() || 'room_event',
      eventPayload: cloneJson(inputRaw.eventPayload),
    }, 'room_event');

    if (!response.ok) {
      return;
    }

    const nextData = asRecord(response.data);
    await this.saveNodeRuntimeData(room.id, nextData);

    scriptableEvents.emit('scripts:state', this.toScriptStatePayload({
      roomId: room.id,
      nodeType: 'room',
      nodeId: room.id,
      clientScript: room.runtime.clientScript,
      serverScript: room.runtime.serverScript,
      data: nextData,
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
    if (generalRoom.node?.clientScript || generalRoom.node?.serverScript) return;

    const definition = getScriptDefinition('room', 'demo:room_meter');
    if (!definition) return;

    const initialData = asRecord(definition.createData ? definition.createData({}) : {});

    await db.node.update({
      where: {
        id: generalRoom.id,
      },
      data: {
        clientScript: definition.clientScript,
        serverScript: definition.serverScript,
        data: mergeNodeData({
          current: generalRoom.node?.data || {},
          patch: initialData,
        }),
      },
    });
  }
}
