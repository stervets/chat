import type {WsEnvelope} from '@/composables/types';

export function registerWsHandlers() {
  const handlers: Record<string, (payload: any) => void> = {};

  const handle = (event: WsEnvelope) => {
    const handler = handlers[event.type];
    handler && handler(event.payload);
  };

  return {
    handlers,
    handle
  };
}
