import {DEFAULT_NICKNAME_COLOR} from '../common/const.js';
import {db} from '../db.js';
import {getRoomById, userCanAccessRoom} from '../common/rooms.js';
import {scriptableEvents} from './events.js';
import {getLatestScriptDefinition, getScriptDefinition} from './registry.js';
import {scriptRunnerClient} from './runner-client.js';
import type {
  ScriptActionResult,
  ScriptEntityType,
  ScriptExecutionMode,
} from './types.js';
import {ChatContext, type ApiError, type ApiOk, type ChatContextMessagePayload} from '../ws/chat/chat-context.js';

type ScriptedMessageRow = {
  id: number;
  roomId: number;
  kind: 'text' | 'system' | 'scriptable';
  scriptId: string | null;
  scriptRevision: number;
  scriptMode: ScriptExecutionMode | null;
  scriptConfigJson: any;
  scriptStateJson: any;
};

type ScriptedRoomRow = {
  id: number;
  kind: 'group' | 'direct' | 'game';
  scriptId: string | null;
  scriptRevision: number;
  scriptMode: ScriptExecutionMode | null;
  scriptConfigJson: any;
  scriptStateJson: any;
};

function normalizeMode(raw: unknown): ScriptExecutionMode | null {
  const mode = String(raw || '').trim().toLowerCase();
  if (mode === 'client' || mode === 'client_server' || mode === 'client_runner') {
    return mode;
  }
  return null;
}

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
    entityType: ScriptEntityType;
    entityId: number;
    scriptId: string;
    scriptRevision: number;
    scriptMode: ScriptExecutionMode;
    scriptStateJson: any;
  }) {
    return {
      roomId: input.roomId,
      entityType: input.entityType,
      entityId: input.entityId,
      scriptId: input.scriptId,
      scriptRevision: input.scriptRevision,
      scriptMode: input.scriptMode,
      scriptStateJson: cloneJson(input.scriptStateJson || {}),
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
    const created = await db.message.create({
      data: {
        roomId,
        senderId: sender.id,
        kind: 'system',
        rawText: compiled.rawText,
        renderedHtml: compiled.renderedHtml,
      },
      select: {
        id: true,
        createdAt: true,
      },
    });

    const payload: ChatContextMessagePayload = {
      id: created.id,
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
      scriptId: null,
      scriptRevision: 0,
      scriptMode: null,
      scriptConfigJson: {},
      scriptStateJson: {},
      createdAt: created.createdAt.toISOString(),
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

  private parseScriptRevision(scriptRevisionRaw: unknown, fallback = 1) {
    const revision = Number.parseInt(String(scriptRevisionRaw ?? ''), 10);
    if (!Number.isFinite(revision) || revision <= 0) return fallback;
    return revision;
  }

  private normalizeConfig(raw: unknown) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return {};
    }
    return cloneJson(raw);
  }

  private normalizeState(raw: unknown) {
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

    const revision = this.parseScriptRevision(payloadRaw?.scriptRevision, 1);
    const definition = getScriptDefinition('message', scriptId, revision)
      || getLatestScriptDefinition('message', scriptId);
    if (!definition) {
      return {ok: false, error: 'script_not_found'};
    }

    const scriptConfigJson = definition.makeInitialConfig
      ? definition.makeInitialConfig(this.normalizeConfig(payloadRaw?.config))
      : this.normalizeConfig(payloadRaw?.config);
    const scriptStateJson = definition.makeInitialState
      ? definition.makeInitialState({config: scriptConfigJson})
      : {};
    const fallbackText = scriptFallbackText(definition.scriptId, definition.revision);
    const fallbackHtml = scriptFallbackHtml(definition.scriptId, definition.revision);

    const created = await db.message.create({
      data: {
        roomId,
        senderId: state.user!.id,
        kind: 'scriptable',
        rawText: fallbackText,
        renderedHtml: fallbackHtml,
        scriptId: definition.scriptId,
        scriptRevision: definition.revision,
        scriptMode: definition.mode,
        scriptConfigJson: cloneJson(scriptConfigJson || {}),
        scriptStateJson: cloneJson(scriptStateJson || {}),
      },
      select: {
        id: true,
        createdAt: true,
      },
    });

    await this.ctx.pruneRoomOverflow(roomId);

    const message: ChatContextMessagePayload = {
      id: created.id,
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
      scriptId: definition.scriptId,
      scriptRevision: definition.revision,
      scriptMode: definition.mode,
      scriptConfigJson: cloneJson(scriptConfigJson || {}),
      scriptStateJson: cloneJson(scriptStateJson || {}),
      createdAt: created.createdAt.toISOString(),
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
        roomId: true,
        kind: true,
        scriptId: true,
        scriptRevision: true,
        scriptMode: true,
        scriptConfigJson: true,
        scriptStateJson: true,
      },
    });
    return row as ScriptedMessageRow | null;
  }

  private async loadScriptedRoom(roomId: number): Promise<ScriptedRoomRow | null> {
    const row = await db.room.findUnique({
      where: {id: roomId},
      select: {
        id: true,
        kind: true,
        scriptId: true,
        scriptRevision: true,
        scriptMode: true,
        scriptConfigJson: true,
        scriptStateJson: true,
      },
    });
    return row as ScriptedRoomRow | null;
  }

  async getRoomScriptEntity(
    state: any,
    roomIdRaw: unknown,
  ): Promise<ApiError | ApiOk<{roomId: number; roomScript: any | null}>> {
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
    if (!scriptedRoom || !scriptedRoom.scriptId || !scriptedRoom.scriptMode || scriptedRoom.scriptRevision <= 0) {
      return {
        ok: true,
        roomId,
        roomScript: null,
      };
    }

    return {
      ok: true,
      roomId,
      roomScript: {
        entityType: 'room',
        entityId: scriptedRoom.id,
        roomId,
        scriptId: scriptedRoom.scriptId,
        scriptRevision: scriptedRoom.scriptRevision,
        scriptMode: scriptedRoom.scriptMode,
        scriptConfigJson: cloneJson(scriptedRoom.scriptConfigJson || {}),
        scriptStateJson: cloneJson(scriptedRoom.scriptStateJson || {}),
      },
    };
  }

  private async applyClientServerAction(input: {
    entityType: ScriptEntityType;
    entityId: number;
    roomId: number;
    scriptId: string;
    scriptRevision: number;
    scriptMode: ScriptExecutionMode;
    scriptConfigJson: any;
    scriptStateJson: any;
    actionType: string;
    actionPayload: any;
    actor: {
      userId: number;
      nickname: string;
      name: string;
    };
  }) {
    const definition = getScriptDefinition(input.entityType, input.scriptId, input.scriptRevision);
    if (!definition || !definition.reduceAction) {
      return {ok: false, error: 'script_action_not_supported'};
    }

    const actionResult = await definition.reduceAction({
      entityType: input.entityType,
      entityId: input.entityId,
      roomId: input.roomId,
      actionType: input.actionType,
      payload: input.actionPayload,
      actor: input.actor,
      config: cloneJson(input.scriptConfigJson || {}),
      state: cloneJson(input.scriptStateJson || {}),
    });
    const nextState = cloneJson(actionResult?.nextState || {});

    if (input.entityType === 'message') {
      await db.message.update({
        where: {id: input.entityId},
        data: {
          scriptStateJson: nextState,
        },
      });
    } else {
      await db.room.update({
        where: {id: input.entityId},
        data: {
          scriptStateJson: nextState,
        },
      });
    }

    scriptableEvents.emit('scripts:state', this.toScriptStatePayload({
      roomId: input.roomId,
      entityType: input.entityType,
      entityId: input.entityId,
      scriptId: input.scriptId,
      scriptRevision: input.scriptRevision,
      scriptMode: input.scriptMode,
      scriptStateJson: nextState,
    }));

    await this.emitSideEffects(input.roomId, actionResult?.sideEffects);

    return {
      ok: true,
      state: nextState,
    };
  }

  private async applyRunnerAction(input: {
    entityType: ScriptEntityType;
    entityId: number;
    roomId: number;
    scriptId: string;
    scriptRevision: number;
    scriptMode: ScriptExecutionMode;
    scriptConfigJson: any;
    scriptStateJson: any;
    actionType: string;
    actionPayload: any;
    actor: {
      userId: number;
      nickname: string;
      name: string;
    };
  }) {
    const response = await scriptRunnerClient.request({
      entityType: input.entityType,
      entityId: input.entityId,
      roomId: input.roomId,
      scriptId: input.scriptId,
      scriptRevision: input.scriptRevision,
      scriptMode: input.scriptMode,
      scriptConfigJson: cloneJson(input.scriptConfigJson || {}),
      scriptStateJson: cloneJson(input.scriptStateJson || {}),
      actionType: input.actionType,
      actionPayload: cloneJson(input.actionPayload),
      actor: input.actor,
    }, 'entity_action');

    if (!response.ok) {
      return {ok: false, error: response.error || 'runner_action_failed'};
    }

    const nextState = cloneJson(response.state || {});

    if (input.entityType === 'message') {
      await db.message.update({
        where: {id: input.entityId},
        data: {
          scriptStateJson: nextState,
        },
      });
    } else {
      await db.room.update({
        where: {id: input.entityId},
        data: {
          scriptStateJson: nextState,
        },
      });
    }

    scriptableEvents.emit('scripts:state', this.toScriptStatePayload({
      roomId: input.roomId,
      entityType: input.entityType,
      entityId: input.entityId,
      scriptId: input.scriptId,
      scriptRevision: input.scriptRevision,
      scriptMode: input.scriptMode,
      scriptStateJson: nextState,
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
  ): Promise<ApiError | ApiOk<{roomId: number; entityType: ScriptEntityType; entityId: number; state: any}>> {
    const authError = this.ctx.requireAuth(state);
    if (authError) return authError;

    const entityTypeRaw = String(payloadRaw?.entityType || '').trim().toLowerCase();
    const entityType: ScriptEntityType | null = entityTypeRaw === 'message'
      ? 'message'
      : (entityTypeRaw === 'room' ? 'room' : null);
    if (!entityType) {
      return {ok: false, error: 'invalid_entity_type'};
    }

    const entityId = Number.parseInt(String(payloadRaw?.entityId ?? ''), 10);
    if (!Number.isFinite(entityId) || entityId <= 0) {
      return {ok: false, error: 'invalid_entity_id'};
    }

    const actionType = String(payloadRaw?.actionType || '').trim();
    if (!actionType) {
      return {ok: false, error: 'invalid_action_type'};
    }

    let roomId = 0;
    let scriptId = '';
    let scriptRevision = 0;
    let scriptMode: ScriptExecutionMode | null = null;
    let scriptConfigJson: any = {};
    let scriptStateJson: any = {};

    if (entityType === 'message') {
      const message = await this.loadScriptedMessage(entityId);
      if (!message || message.kind !== 'scriptable') {
        return {ok: false, error: 'scriptable_message_not_found'};
      }
      roomId = message.roomId;
      scriptId = String(message.scriptId || '').trim().toLowerCase();
      scriptRevision = Number(message.scriptRevision || 0);
      scriptMode = normalizeMode(message.scriptMode);
      scriptConfigJson = cloneJson(message.scriptConfigJson || {});
      scriptStateJson = cloneJson(message.scriptStateJson || {});
    } else {
      const room = await this.loadScriptedRoom(entityId);
      if (!room) {
        return {ok: false, error: 'room_not_found'};
      }
      roomId = room.id;
      scriptId = String(room.scriptId || '').trim().toLowerCase();
      scriptRevision = Number(room.scriptRevision || 0);
      scriptMode = normalizeMode(room.scriptMode);
      scriptConfigJson = cloneJson(room.scriptConfigJson || {});
      scriptStateJson = cloneJson(room.scriptStateJson || {});
    }

    if (!scriptId || !scriptMode || scriptRevision <= 0) {
      return {ok: false, error: 'script_not_configured'};
    }

    const room = await getRoomById(roomId);
    if (!room || !userCanAccessRoom(state.user!.id, room)) {
      return {ok: false, error: 'forbidden'};
    }

    if (scriptMode === 'client') {
      return {ok: false, error: 'script_mode_client_only'};
    }

    const input = {
      entityType,
      entityId,
      roomId,
      scriptId,
      scriptRevision,
      scriptMode,
      scriptConfigJson,
      scriptStateJson,
      actionType,
      actionPayload: cloneJson(payloadRaw?.payload),
      actor: {
        userId: state.user!.id,
        nickname: state.user!.nickname,
        name: state.user!.name || state.user!.nickname,
      },
    };

    const result = scriptMode === 'client_server'
      ? await this.applyClientServerAction(input)
      : await this.applyRunnerAction(input);
    if (!(result as any)?.ok) {
      return {ok: false, error: String((result as any)?.error || 'script_action_failed')};
    }

    return {
      ok: true,
      roomId,
      entityType,
      entityId,
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
    if (!room || !room.scriptId || !room.scriptMode || room.scriptRevision <= 0) return;
    if (room.scriptMode !== 'client_runner') return;

    const response = await scriptRunnerClient.request({
      entityType: 'room',
      entityId: room.id,
      roomId: room.id,
      scriptId: room.scriptId,
      scriptRevision: room.scriptRevision,
      scriptMode: room.scriptMode,
      scriptConfigJson: cloneJson(room.scriptConfigJson || {}),
      scriptStateJson: cloneJson(room.scriptStateJson || {}),
      eventType: String(inputRaw.eventType || '').trim() || 'room_event',
      eventPayload: cloneJson(inputRaw.eventPayload),
    }, 'room_event');

    if (!response.ok) {
      return;
    }

    const nextState = cloneJson(response.state || {});
    await db.room.update({
      where: {id: room.id},
      data: {
        scriptStateJson: nextState,
      },
    });

    scriptableEvents.emit('scripts:state', this.toScriptStatePayload({
      roomId: room.id,
      entityType: 'room',
      entityId: room.id,
      scriptId: room.scriptId,
      scriptRevision: room.scriptRevision,
      scriptMode: room.scriptMode,
      scriptStateJson: nextState,
    }));

    await this.emitSideEffects(room.id, response.sideEffects);
  }

  async ensureDefaultGeneralRoomScript() {
    const generalRoom = await db.room.findFirst({
      where: {kind: 'group'},
      orderBy: {id: 'asc'},
      select: {
        id: true,
        scriptId: true,
      },
    });
    if (!generalRoom) return;
    if (generalRoom.scriptId) return;

    const definition = getLatestScriptDefinition('room', 'demo:room_meter');
    if (!definition) return;

    const scriptConfigJson = definition.makeInitialConfig
      ? definition.makeInitialConfig({})
      : {};
    const scriptStateJson = definition.makeInitialState
      ? definition.makeInitialState({config: scriptConfigJson})
      : {};

    await db.room.update({
      where: {id: generalRoom.id},
      data: {
        scriptId: definition.scriptId,
        scriptRevision: definition.revision,
        scriptMode: definition.mode,
        scriptConfigJson: cloneJson(scriptConfigJson || {}),
        scriptStateJson: cloneJson(scriptStateJson || {}),
      },
    });
  }
}
