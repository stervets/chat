const {readFileSync} = require('node:fs');
const {resolve} = require('node:path');

function loadScriptsConfig() {
  const configPath = resolve(process.cwd(), 'scripts', 'config.json');
  const examplePath = resolve(process.cwd(), 'scripts', 'config.example.json');

  try {
    const raw = readFileSync(configPath, 'utf-8');
    return JSON.parse(raw);
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      const fallbackRaw = readFileSync(examplePath, 'utf-8');
      return JSON.parse(fallbackRaw);
    }
    if (error instanceof SyntaxError) {
      throw new Error(`scripts/config.json invalid JSON: ${error.message}`);
    }
    throw error;
  }
}

function wsToHttpBase(wsUrlRaw) {
  const parsed = new URL(String(wsUrlRaw || '').trim());
  parsed.protocol = parsed.protocol === 'wss:' ? 'https:' : 'http:';
  parsed.pathname = '';
  parsed.search = '';
  parsed.hash = '';
  return parsed.toString().replace(/\/$/, '');
}

function assertNoApiError(result, label) {
  if (result && typeof result === 'object' && result.ok === false) {
    const error = String(result.error || 'unknown_error');
    throw new Error(`${label}: ${error}`);
  }
  if (result && typeof result === 'object' && result.ok === true && Object.prototype.hasOwnProperty.call(result, 'data')) {
    return result.data;
  }
  return result;
}

class WsRpcClient {
  constructor(wsUrl) {
    this.wsUrl = String(wsUrl || '').trim();
    this.ws = null;
    this.seq = 0;
    this.pending = new Map();
  }

  async connect() {
    const WsImpl = globalThis.WebSocket;
    if (!WsImpl) {
      throw new Error('global WebSocket is not available in this Node runtime');
    }

    this.ws = new WsImpl(this.wsUrl);

    await new Promise((resolvePromise, rejectPromise) => {
      const openHandler = () => {
        cleanup();
        resolvePromise();
      };
      const errorHandler = (event) => {
        cleanup();
        rejectPromise(new Error(`ws_connect_failed: ${String(event?.message || '')}`));
      };

      const cleanup = () => {
        this.ws?.removeEventListener('open', openHandler);
        this.ws?.removeEventListener('error', errorHandler);
      };

      this.ws?.addEventListener('open', openHandler);
      this.ws?.addEventListener('error', errorHandler);
    });

    this.ws.addEventListener('message', (event) => {
      this.onMessage(event?.data);
    });

    this.ws.addEventListener('close', () => {
      this.rejectAllPending(new Error('ws_closed'));
    });

    this.ws.addEventListener('error', () => {
      this.rejectAllPending(new Error('ws_error'));
    });
  }

  async close() {
    if (!this.ws) return;
    try {
      this.ws.close();
    } catch {
      // ignore
    }
    this.ws = null;
    this.rejectAllPending(new Error('ws_closed'));
  }

  rejectAllPending(error) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }

  onMessage(rawPayload) {
    let parsed;
    try {
      parsed = JSON.parse(String(rawPayload || ''));
    } catch {
      return;
    }

    if (!Array.isArray(parsed) || parsed[0] !== '[res]') return;
    const requestId = String(parsed[4] || '');
    if (!requestId) return;

    const pending = this.pending.get(requestId);
    if (!pending) return;

    clearTimeout(pending.timer);
    this.pending.delete(requestId);

    const payload = Array.isArray(parsed[1]) ? parsed[1][0] : undefined;
    pending.resolve(payload);
  }

  async request(com, args = {}, timeoutMs = 20_000) {
    if (!this.ws || this.ws.readyState !== this.ws.OPEN) {
      throw new Error('ws_not_open');
    }

    const requestId = `req-${Date.now()}-${++this.seq}`;
    const packet = [
      String(com || ''),
      args && typeof args === 'object' ? args : {},
      'frontend',
      'backend',
      requestId,
    ];

    const resultPromise = new Promise((resolvePromise, rejectPromise) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        rejectPromise(new Error(`ws_timeout:${com}`));
      }, timeoutMs);

      this.pending.set(requestId, {
        resolve: resolvePromise,
        reject: rejectPromise,
        timer,
      });
    });

    this.ws.send(JSON.stringify(packet));
    return resultPromise;
  }
}

async function loginByPassword(client, nickname, password) {
  const result = await client.request('auth:login', {
    nickname,
    password,
  });
  return assertNoApiError(result, 'auth:login');
}

async function restoreSession(client, token) {
  const result = await client.request('auth:session', {token});
  return assertNoApiError(result, 'auth:session');
}

async function createUserViaInvite(adminClient, nickname, password) {
  const invite = assertNoApiError(await adminClient.request('invites:create', {}), 'invites:create');
  const newcomer = new WsRpcClient(CONFIG.backendWsUrl);
  await newcomer.connect();
  try {
    const redeemed = await newcomer.request('invites:redeem', {
      code: invite.code,
      nickname,
      name: nickname,
      password,
    });
    return assertNoApiError(redeemed, 'invites:redeem');
  } finally {
    await newcomer.close();
  }
}

async function uploadTinyPng(apiBase, token, fileName) {
  const body = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7+9WkAAAAASUVORK5CYII=',
    'base64',
  );

  const formData = new FormData();
  formData.set('file', new Blob([body], {type: 'image/png'}), `${fileName}.png`);

  const response = await fetch(`${apiBase}/upload/image`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
    },
    body: formData,
  });

  let json = null;
  try {
    json = await response.json();
  } catch {
    // ignore
  }

  if (!response.ok || !json?.ok) {
    throw new Error(`upload_failed: status=${response.status} body=${JSON.stringify(json)}`);
  }

  return json;
}

function makeUniqueNickname(prefix = 'e2e') {
  const tail = `${Date.now()}${Math.floor(Math.random() * 10000)}`;
  return `${prefix}_${tail}`;
}

const SCRIPT_CONFIG = loadScriptsConfig();
const loginConfig = SCRIPT_CONFIG.e2eLogin || {};
const smokeConfig = SCRIPT_CONFIG.smokeE2E || {};

const CONFIG = {
  backendWsUrl: String(smokeConfig.backendWsUrl || 'ws://127.0.0.1:8816/ws').trim(),
  backendHttpBase: wsToHttpBase(String(smokeConfig.backendWsUrl || 'ws://127.0.0.1:8816/ws').trim()),
  adminNickname: String(loginConfig.nickname || 'lisov').trim(),
  adminPassword: String(loginConfig.password || '123'),
};

module.exports = {
  CONFIG,
  WsRpcClient,
  assertNoApiError,
  loginByPassword,
  restoreSession,
  createUserViaInvite,
  uploadTinyPng,
  makeUniqueNickname,
};
