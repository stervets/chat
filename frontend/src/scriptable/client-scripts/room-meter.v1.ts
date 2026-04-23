import type {ScriptWorkerFactory} from '../runtime/types';

function toRoomView(data: Record<string, any>) {
  const config = data?.scriptConfig && typeof data.scriptConfig === 'object' ? data.scriptConfig : {};
  const state = data?.scriptState && typeof data.scriptState === 'object' ? data.scriptState : {};
  const totalMessages = Math.max(0, Number(state?.totalMessages || 0));
  const lastAuthorNickname = String(state?.lastAuthorNickname || '').trim();

  return {
    kind: 'room_banner',
    title: String(config?.title || 'Скрипт комнаты'),
    subtitle: `Сообщений: ${totalMessages}`,
    extra: lastAuthorNickname ? `Последний автор: @${lastAuthorNickname}` : '',
  };
}

export const roomMeterV1: ScriptWorkerFactory = {
  scriptId: 'demo:room_meter',
  nodeType: 'room',

  create(api) {
    return {
      onInit() {
        api.setLocalState({});
        api.setViewModel(toRoomView(api.getData()));
      },

      onEvent(event) {
        if (String(event?.source || '') !== 'server') return;
        if (String(event?.type || '') !== 'data:update') return;
        const data = event?.payload?.data && typeof event.payload.data === 'object'
          ? event.payload.data
          : api.getData();
        api.setViewModel(toRoomView(data));
      },
    };
  },
};
