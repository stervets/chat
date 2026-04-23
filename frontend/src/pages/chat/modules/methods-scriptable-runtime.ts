import {ws} from './shared';
import type {Message} from './shared';
import {ScriptRuntimeManager} from '@/scriptable/runtime/manager';

export const chatMethodsScriptableRuntime = {
    initScriptRuntimeManager(this: any) {
      if (this.scriptRuntimeManager) return;

      this.scriptRuntimeManager = new ScriptRuntimeManager({
        onViewModel: (nodeType, nodeId, viewModel) => {
          if (nodeType === 'message') {
            this.scriptMessageViewModels = {
              ...this.scriptMessageViewModels,
              [nodeId]: viewModel || {},
            };
            return;
          }
          if (nodeType === 'room') {
            this.activeRoomScriptViewModel = viewModel || null;
          }
        },
        onError: (_nodeType, _nodeId, errorMessage) => {
          this.error = `Script runtime error: ${String(errorMessage || 'unknown_error')}`;
        },
        requestSharedAction: async (snapshot, request) => {
          const hasServer = !!String(snapshot?.serverScript || '').trim();
          if (!hasServer) {
            const state = snapshot?.data?.scriptState;
            return {
              ok: true,
              state: state && typeof state === 'object' && !Array.isArray(state) ? state : {},
            };
          }

          const result = await ws.request('scripts:action', {
            nodeType: snapshot.nodeType,
            nodeId: snapshot.nodeId,
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

      const messageSnapshots = Array.isArray(this.messages) ? [...this.messages] : [];
      const pinnedNodeId = Number(this.activePinnedMessage?.id || 0);
      if (pinnedNodeId > 0) {
        const hasPinnedInTimeline = messageSnapshots.some((message) => Number(message?.id || 0) === pinnedNodeId);
        if (!hasPinnedInTimeline) {
          messageSnapshots.push(this.activePinnedMessage);
        }
      }

      manager.syncMessageRuntimes(messageSnapshots, this.activeDialog?.id || 0);
      manager.syncRoomRuntime(this.activeRoomScript, this.activeDialog?.id || 0);
    },

    setActiveRoomScript(this: any, roomRuntimeRaw: any | null) {
      if (!roomRuntimeRaw || typeof roomRuntimeRaw !== 'object') {
        this.activeRoomScript = null;
        this.activeRoomScriptViewModel = null;
        this.syncScriptableRuntimes();
        return;
      }

      this.activeRoomScript = {
        ...roomRuntimeRaw,
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
      this.setActiveRoomScript((result as any).roomRuntime || null);
    },

    onScriptsState(this: any, payloadRaw: any) {
      const payload = payloadRaw && typeof payloadRaw === 'object' ? payloadRaw : {};
      const nodeType = String(payload.nodeType || '').trim().toLowerCase();
      const nodeId = Number(payload.nodeId || 0);
      const roomId = Number(payload.roomId || 0);
      if (!Number.isFinite(nodeId) || nodeId <= 0) return;
      if (!Number.isFinite(roomId) || roomId <= 0) return;
      const nextRuntime = {
        clientScript: payload?.clientScript ? String(payload.clientScript) : null,
        serverScript: payload?.serverScript ? String(payload.serverScript) : null,
        data: payload?.data && typeof payload.data === 'object' && !Array.isArray(payload.data)
          ? payload.data
          : {},
      };

      if (nodeType === 'message') {
        this.messages = this.messages.map((message: Message) => {
          if (Number(message.id) !== nodeId) return message;
          return {
            ...message,
            runtime: {
              clientScript: nextRuntime.clientScript || message.runtime?.clientScript || null,
              serverScript: nextRuntime.serverScript || message.runtime?.serverScript || null,
              data: nextRuntime.data,
            },
          };
        });
        if (Number(this.activePinnedMessage?.id || 0) === nodeId) {
          this.activePinnedMessage = {
            ...(this.activePinnedMessage || {}),
            runtime: {
              clientScript: nextRuntime.clientScript || this.activePinnedMessage?.runtime?.clientScript || null,
              serverScript: nextRuntime.serverScript || this.activePinnedMessage?.runtime?.serverScript || null,
              data: nextRuntime.data,
            },
          };
        }
      } else if (nodeType === 'room') {
        if (Number(this.activeDialog?.id || 0) === roomId) {
          this.activeRoomScript = {
            ...(this.activeRoomScript || {}),
            nodeType: 'room',
            nodeId,
            roomId,
            clientScript: nextRuntime.clientScript || this.activeRoomScript?.clientScript || null,
            serverScript: nextRuntime.serverScript || this.activeRoomScript?.serverScript || null,
            data: nextRuntime.data,
          };
        }
      }

      this.scriptRuntimeManager?.pushSharedStateUpdate(payload);
      if (nodeType === 'message') {
        this.emitScriptHostRoomEvent('message_script_state', {
          nodeId,
          roomId,
          clientScript: nextRuntime.clientScript,
          serverScript: nextRuntime.serverScript,
        }, 'server', roomId);
      } else if (nodeType === 'room') {
        this.emitScriptHostRoomEvent('room_script_state', {
          nodeId,
          roomId,
          clientScript: nextRuntime.clientScript,
          serverScript: nextRuntime.serverScript,
        }, 'server', roomId);
      }
      this.notifyMessagesChanged();
    },

    onMessageScriptAction(this: any, message: Message, actionTypeRaw: unknown, payload?: any) {
      const actionType = String(actionTypeRaw || '').trim();
      if (!actionType) return;
      this.scriptRuntimeManager?.sendUserAction('message', Number(message.id || 0), actionType, payload);
    },

    onScriptViewMounted(this: any, messageIdRaw: unknown, viewSourceRaw: unknown, viewInstanceIdRaw?: unknown) {
      const messageId = Number(messageIdRaw || 0);
      if (!Number.isFinite(messageId) || messageId <= 0) return;
      this.scriptRuntimeManager?.attachRuntimeView('message', messageId, viewSourceRaw, viewInstanceIdRaw);
    },

    onScriptViewUnmounted(this: any, messageIdRaw: unknown, viewSourceRaw: unknown, viewInstanceIdRaw?: unknown) {
      const messageId = Number(messageIdRaw || 0);
      if (!Number.isFinite(messageId) || messageId <= 0) return;
      this.scriptRuntimeManager?.detachRuntimeView('message', messageId, viewSourceRaw, viewInstanceIdRaw);
    },

    isPinnedScriptPassive(this: any, messageRaw: Message | null) {
      const messageId = Number(messageRaw?.id || 0);
      if (!Number.isFinite(messageId) || messageId <= 0) return false;
      return this.messages.some((message: Message) => Number(message?.id || 0) === messageId);
    },

    getMessageScriptViewModel(this: any, message: Message) {
      const messageId = Number(message?.id || 0);
      if (!Number.isFinite(messageId) || messageId <= 0) return null;
      const viewModel = this.scriptMessageViewModels?.[messageId];
      if (!viewModel || typeof viewModel !== 'object') return null;
      return viewModel;
    },

    emitScriptHostRoomEvent(this: any, eventTypeRaw: unknown, payload?: any, sourceRaw: unknown = 'room', roomIdRaw?: unknown) {
      const roomId = Number(roomIdRaw || this.activeDialog?.id || 0);
      if (!Number.isFinite(roomId) || roomId <= 0) return;
      const eventType = String(eventTypeRaw || '').trim();
      if (!eventType) return;
      this.scriptRuntimeManager?.emitRoomHostEvent(roomId, eventType, payload, sourceRaw);
    },

    async createScriptableMessage(this: any, payloadRaw: any) {
      const roomId = Number(this.activeDialog?.id || 0);
      if (!Number.isFinite(roomId) || roomId <= 0) return null;

      const result = await ws.request('scripts:create-message', roomId, payloadRaw);
      if (!(result as any)?.ok) {
        this.error = 'Не удалось создать scriptable message.';
        return null;
      }
      return this.normalizeMessage((result as any).message || null);
    },

    async createScriptableDemoMessage(this: any, payloadRaw: any) {
      const message = await this.createScriptableMessage(payloadRaw);
      return !!message;
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

    normalizeSurfaceTypeForSetup(this: any, surfaceTypeRaw: unknown) {
      const surfaceType = String(surfaceTypeRaw || '').trim().toLowerCase();
      if (surfaceType === 'llm' || surfaceType === 'poll' || surfaceType === 'dashboard' || surfaceType === 'bot_control' || surfaceType === 'custom') {
        return surfaceType;
      }
      return 'custom';
    },

    async configureActiveRoomSurface(this: any, payloadRaw: any) {
      const roomId = Number(this.activeDialog?.id || 0);
      if (!Number.isFinite(roomId) || roomId <= 0) return null;

      const result = await ws.request('rooms:surface:configure', roomId, payloadRaw);
      if (!(result as any)?.ok) {
        const code = String((result as any)?.error || '');
        if (code === 'room_runtime_required') {
          this.error = 'Для этой room surface нужен room runtime, но он не настроен.';
        } else if (code === 'room_surface_must_be_scriptable') {
          this.error = 'Room surface должен быть scriptable message.';
        } else if (code === 'invalid_surface_type') {
          this.error = 'Некорректный тип room surface.';
        } else if (code === 'room_surface_not_supported') {
          this.error = 'В direct room surface не поддерживается.';
        } else if (code === 'forbidden') {
          this.error = 'Только админ комнаты может менять room surface.';
        } else {
          this.error = 'Не удалось обновить room surface.';
        }
        return null;
      }

      this.onChatRoomUpdated(result);
      const pinnedMessageRaw = (result as any).pinnedMessage;
      this.activePinnedMessage = pinnedMessageRaw && typeof pinnedMessageRaw === 'object'
        ? this.normalizeMessage(pinnedMessageRaw)
        : null;
      this.setActiveRoomScript((result as any).roomRuntime || null);
      return result;
    },

    async createSurfaceRoom(this: any, surfaceTypeRaw: unknown) {
      const surfaceType = this.normalizeSurfaceTypeForSetup(surfaceTypeRaw);
      const defaultTitle = surfaceType === 'poll'
        ? 'Poll room'
        : (surfaceType === 'dashboard' ? 'Dashboard room' : 'Bot-control room');
      const titleRaw = window.prompt('Название surface room', defaultTitle);
      if (titleRaw === null) return false;
      const title = String(titleRaw || '').trim() || defaultTitle;

      const result = await ws.request('rooms:create', {title});
      if (!(result as any)?.ok) {
        this.error = 'Не удалось создать комнату.';
        return false;
      }

      const roomId = Number((result as any).roomId || 0);
      if (!Number.isFinite(roomId) || roomId <= 0) {
        this.error = 'Сервер вернул некорректный roomId.';
        return false;
      }

      await this.selectDialog({
        id: roomId,
        kind: 'group',
        title: String((result as any).title || title || 'Комната'),
        createdById: Number((result as any).createdById || 0) || null,
        pinnedNodeId: null,
        roomSurface: this.normalizeRoomSurface((result as any).roomSurface, null),
      }, {routeMode: 'none'});

      return this.setupCurrentRoomSurface(surfaceType);
    },

    async setupCurrentRoomSurface(this: any, surfaceTypeRaw: unknown) {
      const roomId = Number(this.activeDialog?.id || 0);
      if (!Number.isFinite(roomId) || roomId <= 0) return false;
      if (String(this.activeDialog?.kind || '') === 'direct') {
        this.error = 'В direct room surface не поддерживается.';
        return false;
      }

      const surfaceType = this.normalizeSurfaceTypeForSetup(surfaceTypeRaw);
      const scriptPayload = surfaceType === 'poll'
        ? {
          scriptId: 'demo:poll_surface',
          config: {
            title: 'Голосование',
            question: 'Что берём в релиз в первую очередь?',
            options: ['LLM room', 'Dashboard room', 'Bot-control room'],
          },
        }
        : {
          scriptId: 'demo:bot_control_surface',
          config: {
            title: surfaceType === 'dashboard' ? 'Комнатная панель' : 'Bot control',
            initialEnabled: true,
          },
        };
      const createdMessage = await this.createScriptableMessage(scriptPayload);
      if (!createdMessage?.id) return false;

      await this.configureActiveRoomSurface({
        enabled: true,
        type: surfaceType,
        pinnedNodeId: createdMessage.id,
        config: {
          title: scriptPayload.config.title,
          requireRoomRuntime: false,
        },
      });

      this.closeComposerTools();
      return true;
    },

    async setupPollRoomSurfaceDemo(this: any) {
      await this.setupCurrentRoomSurface('poll');
    },

    async setupBotControlRoomSurfaceDemo(this: any) {
      await this.setupCurrentRoomSurface('bot_control');
    },

    async setupDashboardRoomSurfaceDemo(this: any) {
      await this.setupCurrentRoomSurface('dashboard');
    },

    async disableCurrentRoomSurface(this: any) {
      await this.configureActiveRoomSurface({
        enabled: false,
      });
      this.closeComposerTools();
    },
};
