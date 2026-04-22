import type {ScriptWorkerFactory} from '../runtime/types';

function buildView(config: Record<string, any>, shared: Record<string, any>, local: Record<string, any>) {
  const winners = Array.isArray(shared?.winners) ? shared.winners : [];
  const lastGuess = shared?.lastGuess && typeof shared.lastGuess === 'object'
    ? shared.lastGuess
    : null;

  return {
    kind: 'guess_word',
    title: String(config?.title || 'Угадай слово'),
    hint: String(config?.hint || ''),
    mask: String(shared?.mask || ''),
    attempts: Math.max(0, Number(shared?.attempts || 0)),
    winners,
    pending: !!local?.pending,
    lastGuess,
  };
}

export const messageGuessWordV1: ScriptWorkerFactory = {
  scriptId: 'demo:guess_word',
  revision: 1,
  entityType: 'message',

  create(api) {
    return {
      onInit() {
        const localState = {
          pending: false,
        };
        api.setLocalState(localState);
        api.setViewModel(buildView(api.getConfig(), api.getSharedState(), localState));
      },

      onUserAction(action) {
        if (String(action.actionType || '') !== 'submit_guess') return;
        const guess = String(action.payload?.guess || '').trim();
        if (!guess) return;

        const localState = {
          ...api.getLocalState(),
          pending: true,
        };
        api.setLocalState(localState);
        api.setViewModel(buildView(api.getConfig(), api.getSharedState(), localState));
        api.requestSharedAction('submit_guess', {guess});
      },

      onSharedState(state) {
        const localState = {
          ...api.getLocalState(),
          pending: false,
        };
        api.setLocalState(localState);
        api.setViewModel(buildView(api.getConfig(), state, localState));
      },

      onHostEvent(event) {
        if (String(event.eventType || '') !== 'shared_action_error') return;
        const localState = {
          ...api.getLocalState(),
          pending: false,
        };
        api.setLocalState(localState);
        api.setViewModel(buildView(api.getConfig(), api.getSharedState(), localState));
      },
    };
  },
};
