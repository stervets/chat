import {emit} from '@/composables/event-bus';
import {MaxReserveTransport} from '@/composables/classes/max-reserve-transport';

export type WsResult<T = any> =
  | {ok: true; data: T}
  | {ok: false; error: any};

type MarxPacket = [string, Record<string, any> | any[], string, string, string?];

type ReserveConfig = {
  wsUrl: string;
  token: string;
  deviceId: string;
  chatId: number;
  backendPublicKeyPem: string;
  userAgent: {
    deviceType: string;
    locale: string;
    deviceLocale: string;
    osVersion: string;
    deviceName: string;
    headerUserAgent: string;
    appVersion: string;
    screen: string;
    timezone: string;
  };
};

export class WsClient {
  socket: WebSocket | null = null;
  private connectPromise: Promise<void> | null = null;
  private readonly requests: Record<string, {resolve: (result: WsResult) => void}> = {};
  private lastUrl = '';
  private connectionSeq = 0;
  private reserveActive = false;

  private readonly reserveTransport = new MaxReserveTransport(
    (packet) => this.handleIncomingPacket(packet),
    () => this.onReserveDisconnected(),
  );

  private parsePacket(raw: string): MarxPacket | null {
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

  private resolveAllPendingAsDisconnected() {
    Object.keys(this.requests).forEach((requestId) => {
      this.requests[requestId].resolve({ok: false, error: 'disconnected'});
      delete this.requests[requestId];
    });
  }

  private handleIncomingPacket(packet: MarxPacket) {
    const [com, args, senderId, _recipientId, requestId] = packet;

    if (com === '[res]') {
      if (!requestId || !this.requests[requestId]) return;
      const pending = this.requests[requestId];
      pending.resolve(this.normalizeIncomingResult(Array.isArray(args) ? args[0] : undefined));
      delete this.requests[requestId];
      return;
    }

    emit(com, Array.isArray(args) ? {} : args, senderId);
  }

  private onReserveDisconnected() {
    if (!this.reserveActive) return;
    this.resolveAllPendingAsDisconnected();
    emit('ws:disconnected');
  }

  setReserveConfig(config: ReserveConfig | null) {
    this.reserveTransport.setConfig(config);
  }

  hasReserveConfig() {
    return this.reserveTransport.isConfigured();
  }

  setReserveActive(active: boolean) {
    const next = !!active;
    if (this.reserveActive === next) return;

    this.reserveActive = next;

    if (next) {
      this.connectionSeq += 1;
      this.connectPromise = null;
      const socket = this.socket;
      this.socket = null;
      if (socket) {
        try {
          socket.close();
        } catch {
          // ignore
        }
      }
      return;
    }

    this.reserveTransport.disconnect();
  }

  isReserveActive() {
    return this.reserveActive;
  }

  isConnected() {
    if (this.reserveActive) {
      return this.reserveTransport.isConnected();
    }
    return !!this.socket && this.socket.readyState === WebSocket.OPEN;
  }

  async connectReserve() {
    if (!this.reserveActive) {
      throw new Error('reserve_not_enabled');
    }

    await this.reserveTransport.connect();
    emit('ws:connected');
  }

  connect(url: string) {
    if (this.reserveActive) {
      return this.connectReserve();
    }

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
        const packet = this.parsePacket(String(event.data || ''));
        if (!packet) return;
        this.handleIncomingPacket(packet);
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
        this.resolveAllPendingAsDisconnected();
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

    this.reserveTransport.disconnect();

    if (socket) {
      try {
        socket.close();
      } catch {
        // ignore close failure
      }
    }

    this.resolveAllPendingAsDisconnected();
  }

  async request(com: string, args: Record<string, any> = {}): Promise<WsResult> {
    if (!this.isConnected()) {
      if (!this.lastUrl && !this.reserveActive) {
        return {ok: false, error: 'not_connected'};
      }
      try {
        if (this.reserveActive) {
          await this.connectReserve();
        } else {
          await this.connect(this.lastUrl);
        }
      } catch (error: any) {
        return {
          ok: false,
          error: String(error?.message || error || 'ws_connect_error').trim() || 'ws_connect_error',
        };
      }
    }

    if (!this.isConnected()) {
      return {ok: false, error: 'not_connected'};
    }

    const requestId = this.genId();
    const senderId = this.reserveActive
      ? (this.reserveTransport.getSenderId() || this.reserveTransport.getClientId() || 'frontend')
      : 'frontend';
    const recipientId = this.reserveActive ? '0' : 'backend';

    const packet: MarxPacket = [
      com,
      args,
      senderId,
      recipientId,
      requestId,
    ];

    return new Promise((resolve) => {
      this.requests[requestId] = {resolve};
      const fail = (error: any) => {
        delete this.requests[requestId];
        resolve({
          ok: false,
          error: String(error?.message || error || 'ws_send_error').trim() || 'ws_send_error',
        });
      };

      try {
        if (this.reserveActive) {
          void this.reserveTransport.sendPacket(packet).catch(fail);
          return;
        }
        this.socket!.send(JSON.stringify(packet));
      } catch (error: any) {
        fail(error);
      }
    });
  }

  send(com: string, args: Record<string, any> = {}) {
    if (!this.isConnected()) return;

    const senderId = this.reserveActive
      ? (this.reserveTransport.getSenderId() || this.reserveTransport.getClientId() || 'frontend')
      : 'frontend';
    const recipientId = this.reserveActive ? '0' : 'backend';

    const packet: MarxPacket = [com, args, senderId, recipientId];

    if (this.reserveActive) {
      void this.reserveTransport.sendPacket(packet);
      return;
    }

    this.socket!.send(JSON.stringify(packet));
  }
}

export const ws = new WsClient();
