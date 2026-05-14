import {emit} from '@/composables/event-bus';

export type WsResult<T = any> =
  | {ok: true; data: T}
  | {ok: false; error: any};

export class WsClient {
  socket: WebSocket | null = null;
  private connectPromise: Promise<void> | null = null;
  private readonly requests: Record<string, {resolve: (result: WsResult) => void}> = {};
  private lastUrl = '';
  private connectionSeq = 0;

  private parsePacket(raw: string): [string, Record<string, any> | any[], string, string, string?] | null {
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed) || parsed.length < 4) return null;
      const com = typeof parsed[0] === 'string' ? parsed[0] : '';
      const args = Array.isArray(parsed[1])
        ? parsed[1]
        : parsed[1] && typeof parsed[1] === 'object'
          ? parsed[1]
          : {};
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

  private normalizeIncomingResult(value: any): WsResult {
    if (value && typeof value === 'object' && value.ok === false) {
      return {
        ok: false,
        error: Object.prototype.hasOwnProperty.call(value, 'error') ? value.error : 'server_error',
      };
    }

    if (value && typeof value === 'object' && value.ok === true && Object.prototype.hasOwnProperty.call(value, 'data')) {
      return {ok: true, data: value.data};
    }

    return {ok: true, data: value};
  }

  connect(url: string) {
    if (this.socket?.readyState === WebSocket.OPEN) {
      return Promise.resolve();
    }
    if (this.connectPromise) return this.connectPromise;

    this.lastUrl = url;

    this.connectPromise = new Promise((resolve, reject) => {
      const connectionId = ++this.connectionSeq;
      const socket = new WebSocket(url);
      this.socket = socket;
      let settled = false;
      const connectTimeout = window.setTimeout(() => {
        if (settled) return;
        if (this.socket !== socket) return;
        settled = true;
        this.connectPromise = null;
        this.socket = null;
        try {
          socket.close();
        } catch {
          // ignore close failure on timed out socket
        }
        reject(new Error('ws_connect_timeout'));
      }, 8000);

      const clearConnectTimeout = () => {
        window.clearTimeout(connectTimeout);
      };

      socket.onopen = () => {
        if (this.socket !== socket || connectionId !== this.connectionSeq) {
          try {
            socket.close();
          } catch {
            // ignore stale socket close
          }
          return;
        }
        if (settled) return;
        settled = true;
        clearConnectTimeout();
        this.connectPromise = null;
        emit('ws:connected');
        resolve();
      };

      socket.onmessage = (event) => {
        if (this.socket !== socket || connectionId !== this.connectionSeq) return;
        const packet = this.parsePacket(event.data);
        if (!packet) return;
        const [com, args, senderId, _recipientId, requestId] = packet;

        if (com === '[res]') {
          if (!requestId || !this.requests[requestId]) return;
          const pending = this.requests[requestId];
          pending.resolve(this.normalizeIncomingResult(Array.isArray(args) ? args[0] : undefined));
          delete this.requests[requestId];
          return;
        }

        emit(com, Array.isArray(args) ? {} : args, senderId);
      };

      socket.onerror = () => {
        if (this.socket !== socket || connectionId !== this.connectionSeq) return;
        if (settled) return;
        settled = true;
        clearConnectTimeout();
        this.connectPromise = null;
        reject(new Error('ws_connect_error'));
      };

      socket.onclose = () => {
        if (this.socket !== socket || connectionId !== this.connectionSeq) return;
        clearConnectTimeout();
        this.socket = null;
        this.connectPromise = null;
        Object.keys(this.requests).forEach((requestId) => {
          this.requests[requestId].resolve({ok: false, error: 'disconnected'});
          delete this.requests[requestId];
        });
        if (!settled) {
          settled = true;
          reject(new Error('ws_disconnected'));
        }
        emit('ws:disconnected');
      };
    });

    return this.connectPromise;
  }

  disconnect() {
    const socket = this.socket;
    this.connectionSeq += 1;
    this.connectPromise = null;
    this.socket = null;
    if (!socket) return;
    try {
      socket.close();
    } catch {
      // ignore close failure
    }
  }

  async request(com: string, args: Record<string, any> = {}): Promise<WsResult> {
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
    const packet: [string, Record<string, any>, string, string, string] = [
      com,
      args,
      'frontend',
      'backend',
      requestId,
    ];

    return new Promise((resolve) => {
      this.requests[requestId] = {resolve};
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

  send(com: string, args: Record<string, any> = {}) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    const packet: [string, Record<string, any>, string, string] = [com, args, 'frontend', 'backend'];
    this.socket.send(JSON.stringify(packet));
  }
}

export const ws = new WsClient();
