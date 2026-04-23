import type {ScriptWorkerFactory} from '../runtime/types';

function clampLevel(raw: unknown) {
  const value = Number(raw);
  if (!Number.isFinite(value)) return 50;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function buildView(config: Record<string, any>, shared: Record<string, any>, local: Record<string, any>) {
  return {
    kind: 'bot_control_surface',
    title: String(config?.title || 'Bot control'),
    enabled: !!shared?.enabled,
    level: clampLevel(shared?.level),
    updatedAt: shared?.updatedAt ? String(shared.updatedAt) : '',
    pending: !!local?.pending,
    pendingAction: String(local?.pendingAction || ''),
    chatEvents: Math.max(0, Number(local?.chatEvents || 0)),
  };
}

export const messageBotControlSurfaceV1: ScriptWorkerFactory = {
  scriptId: 'demo:bot_control_surface',
  revision: 1,
  nodeType: 'message',

  create(api) {
    return {
      onInit() {
        const local = {
          pending: false,
          pendingAction: '',
          chatEvents: 0,
        };
        api.setLocalState(local);
        api.setViewModel(buildView(api.getConfig(), api.getSharedState(), local));
      },

      onEvent(event) {
        const source = String(event?.source || '');
        const eventType = String(event?.type || '');

        if (source === 'ui' && eventType === 'ui:action') {
          const actionType = String(event?.payload?.actionType || '');
          const payload = event?.payload?.payload || {};
          if (actionType !== 'toggle_enabled' && actionType !== 'set_level') return;

          const local = {
            ...api.getLocalState(),
            pending: true,
            pendingAction: actionType,
          };
          api.setLocalState(local);
          api.setViewModel(buildView(api.getConfig(), api.getSharedState(), local));
          api.requestSharedAction(actionType, payload);
          return;
        }

        if (source === 'server' && eventType === 'state:update') {
          const nextState = event?.payload?.state && typeof event.payload.state === 'object'
            ? event.payload.state
            : api.getSharedState();
          const local = {
            ...api.getLocalState(),
            pending: false,
            pendingAction: '',
          };
          api.setLocalState(local);
          api.setViewModel(buildView(api.getConfig(), nextState, local));
          return;
        }

        if (source === 'server' && eventType === 'shared_action_error') {
          const local = {
            ...api.getLocalState(),
            pending: false,
            pendingAction: '',
          };
          api.setLocalState(local);
          api.setViewModel(buildView(api.getConfig(), api.getSharedState(), local));
          return;
        }

        if (source === 'room' && (eventType === 'chat_message' || eventType === 'chat_message_updated' || eventType === 'chat_message_deleted')) {
          const local = {
            ...api.getLocalState(),
            chatEvents: Math.max(0, Number(api.getLocalState()?.chatEvents || 0)) + 1,
          };
          api.setLocalState(local);
          api.setViewModel(buildView(api.getConfig(), api.getSharedState(), local));
        }
      },
    };
  },
};
