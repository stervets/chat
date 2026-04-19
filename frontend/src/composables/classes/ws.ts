import {emit} from '@/composables/event-bus';

export class WsClient {
  socket: WebSocket | null = null;
  private connectPromise: Promise<void> | null = null;
  private readonly requests: Record<string, (result: any) => void> = {};
  private lastUrl = '';

  private parsePacket(raw: string): [string, any[], string, string, string?] | null {
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed) || parsed.length < 4) return null;
      const com = typeof parsed[0] === 'string' ? parsed[0] : '';
      const args = Array.isArray(parsed[1]) ? parsed[1] : [];
      const senderId = typeof parsed[2] === 'string' ? parsed[2] : '';
      const recipientId = typeof parsed[3] === 'string' ? parsed[3] : '';
      const requestId = typeof parsed[4] === 'string' ? parsed[4] : undefined;
      if (!com) return null;
      return [com, args, senderId, recipientId, requestId];
    } catch {
      return null;
    }
  }

  private genId() {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }

  connect(url: string) {
    if (this.socket?.readyState === WebSocket.OPEN) {
      return Promise.resolve();
    }
    if (this.connectPromise) return this.connectPromise;

    this.lastUrl = url;

    this.connectPromise = new Promise((resolve, reject) => {
      const socket = new WebSocket(url);
      this.socket = socket;

      socket.onopen = () => {
        this.connectPromise = null;
        emit('ws:connected');
        resolve();
      };

      socket.onmessage = (event) => {
        const packet = this.parsePacket(event.data);
        if (!packet) return;
        const [com, args, senderId, _recipientId, requestId] = packet;

        if (com === '[res]') {
          if (!requestId || !this.requests[requestId]) return;
          this.requests[requestId](args[0]);
          delete this.requests[requestId];
          return;
        }

        emit(com, ...args, senderId);
      };

      socket.onerror = () => {
        if (this.connectPromise) {
          this.connectPromise = null;
          reject(new Error('ws_connect_error'));
        }
      };

      socket.onclose = () => {
        this.socket = null;
        this.connectPromise = null;
        Object.keys(this.requests).forEach((requestId) => {
          this.requests[requestId]({ok: false, error: 'disconnected'});
          delete this.requests[requestId];
        });
        emit('ws:disconnected');
      };
    });

    return this.connectPromise;
  }

  disconnect() {
    if (!this.socket) return;
    this.socket.close();
    this.socket = null;
  }

  async request(com: string, ...args: any[]) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      if (!this.lastUrl) {
        return {ok: false, error: 'not_connected'};
      }
      try {
        await this.connect(this.lastUrl);
      } catch (error: any) {
        return {
          ok: false,
          error: String(error?.message || error || 'ws_connect_error').trim() || 'ws_connect_error',
        };
      }
    }

    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return {ok: false, error: 'not_connected'};
    }

    const requestId = this.genId();
    const packet: [string, any[], string, string, string] = [
      com,
      args,
      'frontend',
      'backend',
      requestId,
    ];

    return new Promise((resolve) => {
      this.requests[requestId] = resolve;
      try {
        this.socket!.send(JSON.stringify(packet));
      } catch (error: any) {
        delete this.requests[requestId];
        resolve({
          ok: false,
          error: String(error?.message || error || 'ws_send_error').trim() || 'ws_send_error',
        });
      }
    });
  }

  send(com: string, ...args: any[]) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    const packet: [string, any[], string, string] = [com, args, 'frontend', 'backend'];
    this.socket.send(JSON.stringify(packet));
  }
}

export const ws = new WsClient();
