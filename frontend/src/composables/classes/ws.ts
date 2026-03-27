import type {WsEnvelope} from '@/composables/types';
import {WS_PATH} from '@/composables/const';

export class WsClient {
  socket: WebSocket | null = null;

  connect(baseUrl?: string) {
    if (this.socket) return;
    const url = baseUrl || `${location.origin.replace('http', 'ws')}${WS_PATH}`;
    this.socket = new WebSocket(url);
  }

  send(event: WsEnvelope) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    this.socket.send(JSON.stringify(event));
  }
}

export const ws = new WsClient();
