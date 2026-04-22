import type {ScriptWorkerFactory} from '../runtime/types';

function toRoomView(config: Record<string, any>, shared: Record<string, any>) {
  const totalMessages = Math.max(0, Number(shared?.totalMessages || 0));
  const lastAuthorNickname = String(shared?.lastAuthorNickname || '').trim();

  return {
    kind: 'room_banner',
    title: String(config?.title || 'Скрипт комнаты'),
    subtitle: `Сообщений: ${totalMessages}`,
    extra: lastAuthorNickname ? `Последний автор: @${lastAuthorNickname}` : '',
  };
}

export const roomMeterV1: ScriptWorkerFactory = {
  scriptId: 'demo:room_meter',
  revision: 1,
  entityType: 'room',

  create(api) {
    return {
      onInit() {
        api.setLocalState({});
        api.setViewModel(toRoomView(api.getConfig(), api.getSharedState()));
      },

      onSharedState(state) {
        api.setViewModel(toRoomView(api.getConfig(), state));
      },
    };
  },
};
