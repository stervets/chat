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
          api.setViewModel(buildView(api.getConfig(), api.getSharedState(), localState));
          api.requestSharedAction('submit_guess', {guess});
          return;
        }

        if (source === 'server' && eventType === 'state:update') {
          const state = event?.payload?.state && typeof event.payload.state === 'object'
            ? event.payload.state
            : api.getSharedState();
          const localState = {
            ...api.getLocalState(),
            pending: false,
          };
          api.setLocalState(localState);
          api.setViewModel(buildView(api.getConfig(), state, localState));
          return;
        }

        if (source === 'server' && eventType === 'shared_action_error') {
          const localState = {
            ...api.getLocalState(),
            pending: false,
          };
          api.setLocalState(localState);
          api.setViewModel(buildView(api.getConfig(), api.getSharedState(), localState));
        }
      },
    };
  },
};
