import {randomBytes} from 'node:crypto';
import {WebSocket} from 'ws';
import {config} from '../config.js';
import type {RunnerRequest, RunnerResponse} from './runner-protocol.js';

type PendingRequest = {
  resolve: (value: RunnerResponse) => void;
  timer: NodeJS.Timeout;
};

const REQUEST_TIMEOUT_MS = 5000;
const RECONNECT_DELAY_MS = 1500;

export class ScriptRunnerClient {
  private socket: WebSocket | null = null;
  private connectTimer: NodeJS.Timeout | null = null;
  private connecting = false;
  private readonly pending = new Map<string, PendingRequest>();
  private readonly enabled = !!config.scriptRunner.enabled;

  start() {
    if (!this.enabled) return;
    this.ensureConnected();
  }

  isConnected() {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  stop() {
    if (this.connectTimer) {
      clearTimeout(this.connectTimer);
      this.connectTimer = null;
    }
    if (this.socket) {
      try {
        this.socket.close();
      } catch {
        // no-op
      }
      this.socket = null;
    }

    for (const [requestId, pending] of this.pending.entries()) {
      clearTimeout(pending.timer);
      pending.resolve({
        id: requestId,
        ok: false,
        error: 'runner_disconnected',
      });
    }
    this.pending.clear();
  }

  private scheduleReconnect() {
    if (!this.enabled) return;
    if (this.connectTimer) return;
    this.connectTimer = setTimeout(() => {
      this.connectTimer = null;
      this.ensureConnected();
    }, RECONNECT_DELAY_MS);
    this.connectTimer.unref();
  }

  private ensureConnected() {
    if (!this.enabled) return;
    if (this.connecting) return;
    if (this.socket?.readyState === WebSocket.OPEN) return;

    this.connecting = true;
    const ws = new WebSocket(config.scriptRunner.url);
    this.socket = ws;

    ws.on('open', () => {
      this.connecting = false;
    });

    ws.on('message', (raw) => {
      let parsed: RunnerResponse | null = null;
      try {
        parsed = JSON.parse(String(raw));
      } catch {
        parsed = null;
      }
      if (!parsed || typeof parsed.id !== 'string') return;
      const pending = this.pending.get(parsed.id);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pending.delete(parsed.id);
      pending.resolve(parsed);
    });

    ws.on('close', () => {
      this.connecting = false;
      this.socket = null;
      this.scheduleReconnect();
    });

    ws.on('error', () => {
      this.connecting = false;
      this.scheduleReconnect();
    });
  }

  async request(payloadRaw: Omit<RunnerRequest, 'id'>['payload'], type: RunnerRequest['type']): Promise<RunnerResponse> {
    if (!this.enabled) {
      return {id: '', ok: false, error: 'runner_disabled'};
    }

    this.ensureConnected();
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return {id: '', ok: false, error: 'runner_not_connected'};
    }

    const id = randomBytes(8).toString('hex');
    const request: RunnerRequest = {
      id,
      type,
      payload: payloadRaw,
    };

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        resolve({
          id,
          ok: false,
          error: 'runner_timeout',
        });
      }, REQUEST_TIMEOUT_MS);
      timer.unref();

      this.pending.set(id, {resolve, timer});

      try {
        this.socket!.send(JSON.stringify(request));
      } catch {
        clearTimeout(timer);
        this.pending.delete(id);
        resolve({
          id,
          ok: false,
          error: 'runner_send_failed',
        });
      }
    });
  }
}

export const scriptRunnerClient = new ScriptRunnerClient();
