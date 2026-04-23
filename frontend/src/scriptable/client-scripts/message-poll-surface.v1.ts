import type {ScriptWorkerFactory} from '../runtime/types';

function normalizeOptions(raw: unknown) {
  const options = Array.isArray(raw)
    ? raw
      .filter((item) => item && typeof item === 'object')
      .map((item: any, index) => ({
        index: Number.isFinite(Number(item.index)) ? Number(item.index) : index,
        label: String(item.label || `Option ${index + 1}`),
        votes: Math.max(0, Number(item.votes || 0)),
      }))
    : [];
  return options;
}

function buildView(config: Record<string, any>, shared: Record<string, any>, local: Record<string, any>) {
  const options = normalizeOptions(shared?.options);
  const pendingOptionIndex = Number(local?.pendingOptionIndex ?? -1);
  const totalVotes = Math.max(0, Number(shared?.totalVotes || 0));

  return {
    kind: 'poll_surface',
    title: String(config?.title || 'Голосование'),
    question: String(config?.question || 'Выберите вариант'),
    options,
    totalVotes,
    pending: !!local?.pending,
    pendingOptionIndex: Number.isFinite(pendingOptionIndex) ? pendingOptionIndex : -1,
    chatEvents: Math.max(0, Number(local?.chatEvents || 0)),
  };
}

export const messagePollSurfaceV1: ScriptWorkerFactory = {
  scriptId: 'demo:poll_surface',
  revision: 1,
  nodeType: 'message',

  create(api) {
    return {
      onInit() {
        const local = {
          pending: false,
          pendingOptionIndex: -1,
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
          if (actionType !== 'vote_option') return;

          const optionIndex = Number(event?.payload?.payload?.optionIndex);
          if (!Number.isFinite(optionIndex) || optionIndex < 0) return;

          const local = {
            ...api.getLocalState(),
            pending: true,
            pendingOptionIndex: optionIndex,
          };
          api.setLocalState(local);
          api.setViewModel(buildView(api.getConfig(), api.getSharedState(), local));
          api.requestSharedAction('vote', {optionIndex});
          return;
        }

        if (source === 'server' && eventType === 'state:update') {
          const nextState = event?.payload?.state && typeof event.payload.state === 'object'
            ? event.payload.state
            : api.getSharedState();
          const local = {
            ...api.getLocalState(),
            pending: false,
            pendingOptionIndex: -1,
          };
          api.setLocalState(local);
          api.setViewModel(buildView(api.getConfig(), nextState, local));
          return;
        }

        if (source === 'server' && eventType === 'shared_action_error') {
          const local = {
            ...api.getLocalState(),
            pending: false,
            pendingOptionIndex: -1,
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
