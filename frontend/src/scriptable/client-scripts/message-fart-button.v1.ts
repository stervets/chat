import type {ScriptWorkerFactory} from '../runtime/types';

export const messageFartButtonV1: ScriptWorkerFactory = {
  scriptId: 'demo:fart_button',
  nodeType: 'message',

  create(api) {
    return {
      onInit() {
        api.setLocalState({
          clicks: Number(api.getLocalState()?.clicks || 0),
          pulse: false,
          soundTick: Number(api.getLocalState()?.soundTick || 0),
        });

        api.setViewModel({
          kind: 'button_sound',
          title: String(api.getData()?.config?.title || 'Локальная кнопка'),
          buttonLabel: String(api.getData()?.config?.buttonLabel || 'Пукнуть'),
          clicks: Number(api.getLocalState()?.clicks || 0),
          soundUrl: String(api.getData()?.config?.soundUrl || '/ping.mp3'),
          pulse: false,
        });
      },

      onEvent(event) {
        if (String(event?.source || '') !== 'ui') return;
        if (String(event?.type || '') !== 'ui:action') return;
        if (String(event?.payload?.actionType || '') !== 'click') return;
        const local = api.getLocalState();
        const clicks = Math.max(0, Number(local?.clicks || 0)) + 1;
        const soundTick = Math.max(0, Number(local?.soundTick || 0)) + 1;

        api.setLocalState({
          ...local,
          clicks,
          soundTick,
          pulse: true,
        });

        api.setViewModel({
          kind: 'button_sound',
          title: String(api.getData()?.config?.title || 'Локальная кнопка'),
          buttonLabel: String(api.getData()?.config?.buttonLabel || 'Пукнуть'),
          clicks,
          soundUrl: String(api.getData()?.config?.soundUrl || '/ping.mp3'),
          pulse: true,
          soundTick,
        });
      },
    };
  },
};
