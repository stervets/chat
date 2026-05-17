import {emit} from '@/composables/event-bus';
import {MaxReserveTransport} from '@/composables/classes/max-reserve-transport';

export type WsResult<T = any> =
  | {ok: true; data: T}
  | {ok: false; error: any};

type MarxPacket = [string, Record<string, any> | any[], string, string, string?];
const REQUEST_TIMEOUT_MS = 12000;
const RESERVE_DEDUPE_COMMANDS = new Set([
  'auth:session',
  'user:list',
  'contacts:list',
  'room:list',
  'room:get',
  'room:group:get-default',
  'message:list',
  'push:native:register',
]);

type ReserveConfig = {
  wsUrl: string;
  token: string;
  deviceId: string;
  chatId: number;
  chunkTextLimit: number;
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
  private readonly requests: Record<string, {resolve: (result: WsResult) => void; timerId: number; com: string}> = {};
  private lastUrl = '';
  private connectionSeq = 0;
  private reserveActive = false;
  private reservePendingCount = 0;
  private lastReserveRequest: {com: string; args: Record<string, any>} | null = null;
  private readonly reserveRequestDedup = new Map<string, Promise<WsResult>>();

  private readonly reserveTransport = new MaxReserveTransport(
    (packet) => this.handleIncomingPacket(packet),
    () => this.onReserveDisconnected(),
  );

  private closeSocket(socket: WebSocket | null) {
    if (!socket) return;
    try {
      socket.close();
    } catch {
      // ignore close failure
    }
  }

  private getSenderId() {
    return this.reserveActive
      ? (this.reserveTransport.getSenderId() || this.reserveTransport.getClientId() || 'frontend')
      : 'frontend';
  }

  private getRecipientId() {
    return this.reserveActive ? '0' : 'backend';
  }

  private buildPacket(com: string, args: Record<string, any>, requestId?: string): MarxPacket {
    const packet: MarxPacket = [com, args, this.getSenderId(), this.getRecipientId()];
    if (requestId) packet.push(requestId);
    return packet;
  }

  private sendTransportPacket(packet: MarxPacket) {
    if (this.reserveActive) return this.reserveTransport.sendPacket(packet);
    this.socket!.send(JSON.stringify(packet));
    return Promise.resolve();
  }

  private shouldDedupeReserveRequest(com: string) {
    return RESERVE_DEDUPE_COMMANDS.has(String(com || '').trim());
  }

  private buildReserveRequestKey(com: string, args: Record<string, any>) {
    return `${String(com || '').trim()}::${JSON.stringify(args || {})}`;
  }

  private emitReserveRequestState() {
    emit('reserve:request-state', {
      active: this.reserveActive && this.reservePendingCount > 0,
      pendingCount: this.reservePendingCount,
      com: String(this.lastReserveRequest?.com || '').trim(),
      retryAvailable: !!this.lastReserveRequest,
    });
  }

  private beginReserveRequest(com: string, args: Record<string, any>) {
    this.reservePendingCount += 1;
    this.lastReserveRequest = {com, args};
    this.emitReserveRequestState();
  }

  private endReserveRequest() {
    this.reservePendingCount = Math.max(0, this.reservePendingCount - 1);
    this.emitReserveRequestState();
  }

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
      clearTimeout(this.requests[requestId].timerId);
      this.requests[requestId].resolve({ok: false, error: 'disconnected'});
      delete this.requests[requestId];
    });
  }

  private handleIncomingPacket(packet: MarxPacket) {
    const [com, args, senderId, _recipientId, requestId] = packet;

    if (com === '[res]') {
      if (!requestId || !this.requests[requestId]) return;
      const pending = this.requests[requestId];
      clearTimeout(pending.timerId);
      pending.resolve(this.normalizeIncomingResult(Array.isArray(args) ? args[0] : undefined));
      delete this.requests[requestId];
      if (this.reserveActive) {
        this.endReserveRequest();
      }
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

  setReserveActive(active: boolean) {
    const next = !!active;
    if (this.reserveActive === next) return;

    console.info(`[ws-route] reserveActive=${next ? '1' : '0'}`);
    this.reserveActive = next;
    if (!next) {
      this.reservePendingCount = 0;
      this.emitReserveRequestState();
    }

    if (next) {
      this.connectionSeq += 1;
      this.connectPromise = null;
      const socket = this.socket;
      this.socket = null;
      this.closeSocket(socket);
      return;
    }

    this.reserveTransport.disconnect();
  }

  isReserveActive() {
    return this.reserveActive;
  }

  getReservePendingCount() {
    return this.reservePendingCount;
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
        this.closeSocket(socket);
        reject(new Error('ws_connect_timeout'));
      }, 8000);

      const clearConnectTimeout = () => {
        window.clearTimeout(connectTimeout);
      };

      socket.onopen = () => {
        if (this.socket !== socket || connectionId !== this.connectionSeq) {
          this.closeSocket(socket);
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

    this.closeSocket(socket);

    this.resolveAllPendingAsDisconnected();
  }

  async request(com: string, args: Record<string, any> = {}): Promise<WsResult> {
    if (this.reserveActive && this.shouldDedupeReserveRequest(com)) {
      const dedupKey = this.buildReserveRequestKey(com, args);
      const existing = this.reserveRequestDedup.get(dedupKey);
      if (existing) {
        return existing;
      }
      const pending = this.requestInternal(com, args).finally(() => {
        this.reserveRequestDedup.delete(dedupKey);
      });
      this.reserveRequestDedup.set(dedupKey, pending);
      return pending;
    }

    return this.requestInternal(com, args);
  }

  async requestInternal(com: string, args: Record<string, any> = {}): Promise<WsResult> {
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
    const senderId = this.getSenderId();
    const recipientId = this.getRecipientId();
    const packet = this.buildPacket(com, args, requestId);

    if (com === 'auth:login' || this.reserveActive) {
      console.info(`[ws-route] request com=${com} via=${this.reserveActive ? 'max' : 'ws'} sender=${senderId} recipient=${recipientId} requestId=${requestId}`);
    }

    return new Promise((resolve) => {
      if (this.reserveActive) {
        this.beginReserveRequest(com, args);
      }
      const timerId = window.setTimeout(() => {
        const pending = this.requests[requestId];
        if (!pending) return;
        delete this.requests[requestId];
        console.warn(`[ws-route] request timeout com=${pending.com} via=${this.reserveActive ? 'max' : 'ws'} requestId=${requestId}`);
        if (this.reserveActive) {
          this.endReserveRequest();
        }
        resolve({ok: false, error: 'timeout'});
      }, REQUEST_TIMEOUT_MS);

      this.requests[requestId] = {
        resolve,
        timerId,
        com,
      };
      const fail = (error: any) => {
        clearTimeout(timerId);
        delete this.requests[requestId];
        if (this.reserveActive) {
          this.endReserveRequest();
        }
        resolve({
          ok: false,
          error: String(error?.message || error || 'ws_send_error').trim() || 'ws_send_error',
        });
      };

      try {
        void this.sendTransportPacket(packet).catch(fail);
      } catch (error: any) {
        fail(error);
      }
    });
  }

  retryLastReserveRequest() {
    if (!this.lastReserveRequest) {
      return Promise.resolve<WsResult>({ok: false, error: 'reserve_retry_missing'});
    }
    const request = this.lastReserveRequest;
    return this.request(request.com, request.args);
  }

  send(com: string, args: Record<string, any> = {}) {
    if (!this.isConnected()) return;

    void this.sendTransportPacket(this.buildPacket(com, args));
  }
}

export const ws = new WsClient();
