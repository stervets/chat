import type {ScriptWorkerFactory} from '../runtime/types';

function buildView(data: Record<string, any>, local: Record<string, any>) {
  const config = data?.scriptConfig && typeof data.scriptConfig === 'object' ? data.scriptConfig : {};
  const state = data?.scriptState && typeof data.scriptState === 'object' ? data.scriptState : {};
  const winners = Array.isArray(state?.winners) ? state.winners : [];
  const lastGuess = state?.lastGuess && typeof state.lastGuess === 'object'
    ? state.lastGuess
    : null;

  return {
    kind: 'guess_word',
    title: String(config?.title || 'Угадай слово'),
    hint: String(config?.hint || ''),
    mask: String(state?.mask || ''),
    attempts: Math.max(0, Number(state?.attempts || 0)),
    winners,
    pending: !!local?.pending,
    lastGuess,
  };
}

export const messageGuessWordV1: ScriptWorkerFactory = {
  scriptId: 'demo:guess_word',
  nodeType: 'message',

  create(api) {
    return {
      onInit() {
        const localState = {
          pending: false,
        };
        api.setLocalState(localState);
        api.setViewModel(buildView(api.getData(), localState));
      },

      onEvent(event) {
        const source = String(event?.source || '');
        const eventType = String(event?.type || '');

        if (source === 'ui' && eventType === 'ui:action') {
          if (String(event?.payload?.actionType || '') !== 'submit_guess') return;
          const guess = String(event?.payload?.payload?.guess || '').trim();
          if (!guess) return;

          const localState = {
            ...api.getLocalState(),
            pending: true,
          };
          api.setLocalState(localState);
          api.setViewModel(buildView(api.getData(), localState));
          api.requestRuntimeAction('submit_guess', {guess});
          return;
        }

        if (source === 'server' && eventType === 'data:update') {
          const data = event?.payload?.data && typeof event.payload.data === 'object'
            ? event.payload.data
            : api.getData();
          const localState = {
            ...api.getLocalState(),
            pending: false,
          };
          api.setLocalState(localState);
          api.setViewModel(buildView(data, localState));
          return;
        }

        if (source === 'server' && eventType === 'runtime_action_error') {
          const localState = {
            ...api.getLocalState(),
            pending: false,
          };
          api.setLocalState(localState);
          api.setViewModel(buildView(api.getData(), localState));
        }
      },
    };
  },
};
