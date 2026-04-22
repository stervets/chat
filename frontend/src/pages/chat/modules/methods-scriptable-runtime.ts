import {ws} from './shared';
import type {Message} from './shared';
import {ScriptRuntimeManager} from '@/scriptable/runtime/manager';

export const chatMethodsScriptableRuntime = {
    initScriptRuntimeManager(this: any) {
      if (this.scriptRuntimeManager) return;

      this.scriptRuntimeManager = new ScriptRuntimeManager({
        onViewModel: (entityType, entityId, viewModel) => {
          if (entityType === 'message') {
            this.scriptMessageViewModels = {
              ...this.scriptMessageViewModels,
              [entityId]: viewModel || {},
            };
            return;
          }
          if (entityType === 'room') {
            this.activeRoomScriptViewModel = viewModel || null;
          }
        },
        onError: (_entityType, _entityId, errorMessage) => {
          this.error = `Script runtime error: ${String(errorMessage || 'unknown_error')}`;
        },
        requestSharedAction: async (snapshot, request) => {
          if (snapshot.scriptMode === 'client') {
            return {ok: true, state: snapshot.scriptStateJson || {}};
          }

          const result = await ws.request('scripts:action', {
            entityType: snapshot.entityType,
            entityId: snapshot.entityId,
            actionType: request.actionType,
            payload: request.payload,
          });
          if (!(result as any)?.ok) {
            return {ok: false};
          }

          const state = (result as any)?.state && typeof (result as any).state === 'object'
            ? (result as any).state
            : {};
          return {
            ok: true,
            state,
          };
        },
      });
    },

    disposeScriptRuntimeManager(this: any) {
      if (this.scriptRuntimeManager) {
        this.scriptRuntimeManager.disposeAll();
      }
      this.scriptRuntimeManager = null;
      this.scriptMessageViewModels = {};
      this.activeRoomScriptViewModel = null;
    },

    syncScriptableRuntimes(this: any) {
      this.initScriptRuntimeManager();
      const manager = this.scriptRuntimeManager as ScriptRuntimeManager | null;
      if (!manager) return;

      manager.syncMessageRuntimes(this.messages, this.activeDialog?.id || 0);
      manager.syncRoomRuntime(this.activeRoomScript, this.activeDialog?.id || 0);
    },

    setActiveRoomScript(this: any, roomScriptRaw: any | null) {
      if (!roomScriptRaw || typeof roomScriptRaw !== 'object') {
        this.activeRoomScript = null;
        this.activeRoomScriptViewModel = null;
        this.syncScriptableRuntimes();
        return;
      }

      this.activeRoomScript = {
        ...roomScriptRaw,
      };
      this.syncScriptableRuntimes();
    },

    async loadActiveRoomScript(this: any, roomIdRaw: unknown) {
      const roomId = Number(roomIdRaw || 0);
      if (!Number.isFinite(roomId) || roomId <= 0) {
        this.setActiveRoomScript(null);
        return;
      }

      const result = await ws.request('scripts:room:get', roomId);
      if (!(result as any)?.ok) {
        this.setActiveRoomScript(null);
        return;
      }
      this.setActiveRoomScript((result as any).roomScript || null);
    },

    onScriptsState(this: any, payloadRaw: any) {
      const payload = payloadRaw && typeof payloadRaw === 'object' ? payloadRaw : {};
      const entityType = String(payload.entityType || '').trim().toLowerCase();
      const entityId = Number(payload.entityId || 0);
      const roomId = Number(payload.roomId || 0);
      if (!Number.isFinite(entityId) || entityId <= 0) return;
      if (!Number.isFinite(roomId) || roomId <= 0) return;

      if (entityType === 'message') {
        this.messages = this.messages.map((message: Message) => {
          if (Number(message.id) !== entityId) return message;
          return {
            ...message,
            scriptStateJson: payload.scriptStateJson && typeof payload.scriptStateJson === 'object'
              ? payload.scriptStateJson
              : {},
            scriptRevision: Number(payload.scriptRevision || message.scriptRevision || 0),
            scriptMode: payload.scriptMode || message.scriptMode || null,
          };
        });
      } else if (entityType === 'room') {
        if (Number(this.activeDialog?.id || 0) === roomId) {
          this.activeRoomScript = {
            ...(this.activeRoomScript || {}),
            entityType: 'room',
            entityId,
            roomId,
            scriptId: String(payload.scriptId || this.activeRoomScript?.scriptId || ''),
            scriptRevision: Number(payload.scriptRevision || this.activeRoomScript?.scriptRevision || 0),
            scriptMode: payload.scriptMode || this.activeRoomScript?.scriptMode || null,
            scriptConfigJson: this.activeRoomScript?.scriptConfigJson || {},
            scriptStateJson: payload.scriptStateJson && typeof payload.scriptStateJson === 'object'
              ? payload.scriptStateJson
              : {},
          };
        }
      }

      this.scriptRuntimeManager?.pushSharedStateUpdate(payload);
      this.notifyMessagesChanged();
    },

    onMessageScriptAction(this: any, message: Message, actionTypeRaw: unknown, payload?: any) {
      const actionType = String(actionTypeRaw || '').trim();
      if (!actionType) return;
      this.scriptRuntimeManager?.sendUserAction('message', Number(message.id || 0), actionType, payload);
    },

    getMessageScriptViewModel(this: any, message: Message) {
      const messageId = Number(message?.id || 0);
      if (!Number.isFinite(messageId) || messageId <= 0) return null;
      const viewModel = this.scriptMessageViewModels?.[messageId];
      if (!viewModel || typeof viewModel !== 'object') return null;
      return viewModel;
    },

    emitScriptHostRoomEvent(this: any, eventTypeRaw: unknown, payload?: any) {
      const roomId = Number(this.activeDialog?.id || 0);
      if (!Number.isFinite(roomId) || roomId <= 0) return;
      const eventType = String(eventTypeRaw || '').trim();
      if (!eventType) return;
      this.scriptRuntimeManager?.emitRoomHostEvent(roomId, eventType, payload);
    },

    async createScriptableDemoMessage(this: any, payloadRaw: any) {
      const roomId = Number(this.activeDialog?.id || 0);
      if (!Number.isFinite(roomId) || roomId <= 0) return false;

      const result = await ws.request('scripts:create-message', roomId, payloadRaw);
      if (!(result as any)?.ok) {
        this.error = 'Не удалось создать scriptable message.';
        return false;
      }
      return true;
    },

    async createDemoFartMessage(this: any) {
      await this.createScriptableDemoMessage({
        scriptId: 'demo:fart_button',
      });
      this.closeComposerTools();
    },

    async createDemoGuessWordMessage(this: any) {
      const raw = window.prompt('Слово для guess_word', 'marx');
      if (raw === null) return;
      const answer = String(raw || '').trim().toLowerCase();
      if (!answer) {
        this.error = 'Нужно ввести слово.';
        return;
      }

      await this.createScriptableDemoMessage({
        scriptId: 'demo:guess_word',
        config: {
          answer,
          hint: `Слово из ${answer.length} букв`,
        },
      });
      this.closeComposerTools();
    },
};
