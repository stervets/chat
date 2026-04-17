import {ref} from 'vue';
import {getWsUrlCandidates} from '@/composables/api';
import {ws} from '@/composables/classes/ws';
import {emit, on} from '@/composables/event-bus';

const SESSION_TOKEN_KEY = 'marx_session_token';
const RECONNECT_BASE_DELAY_MS = 500;
const RECONNECT_MAX_DELAY_MS = 12000;

const hasWindow = () => typeof window !== 'undefined';

type WsConnectionState = 'disconnected' | 'connecting' | 'connected';

export const wsConnectionState = ref<WsConnectionState>('disconnected');

let reconnectHooksReady = false;
let reconnectAttempt = 0;
let reconnectTimer: number | null = null;
let reconnectInFlight = false;
let reconnectDialogResolver: (() => number | null) | null = null;

function setWsState(nextState: WsConnectionState) {
  wsConnectionState.value = nextState;
}

function resetReconnectAttempts() {
  reconnectAttempt = 0;
}

function clearReconnectTimer() {
  if (!hasWindow()) return;
  if (reconnectTimer === null) return;
  window.clearTimeout(reconnectTimer);
  reconnectTimer = null;
}

function stopReconnectLoop() {
  clearReconnectTimer();
  reconnectInFlight = false;
  resetReconnectAttempts();
}

function getReconnectDelayMs(attempt: number) {
  return Math.min(RECONNECT_BASE_DELAY_MS * (2 ** attempt), RECONNECT_MAX_DELAY_MS);
}

function parseReconnectDialogId() {
  const dialogId = Number(reconnectDialogResolver?.() || 0);
  if (!Number.isFinite(dialogId) || dialogId <= 0) return null;
  return dialogId;
}

async function joinActiveDialogAfterReconnect() {
  const dialogId = parseReconnectDialogId();
  if (!dialogId) return null;

  const result = await ws.request('chat:join', dialogId);
  if (!(result as any)?.ok) return null;
  return dialogId;
}

async function connectToAnyWsUrl() {
  const wsUrls = getWsUrlCandidates();
  if (!wsUrls.length) {
    return {ok: false, error: 'ws_url_empty'};
  }

  let lastError = '';
  for (const wsUrl of wsUrls) {
    try {
      await ws.connect(wsUrl);
      return {ok: true};
    } catch (err: any) {
      lastError = String(err?.message || err || 'ws_connect_error');
    }
  }

  return {ok: false, error: lastError || 'ws_connect_error'};
}

async function authSessionByToken(token: string) {
  const result = await ws.request('auth:session', token);
  if ((result as any)?.ok) return result;
  if ((result as any)?.error === 'unauthorized') {
    clearSessionToken();
  }
  return result;
}

function shouldScheduleReconnect() {
  return !!getSessionToken();
}

function scheduleReconnect() {
  if (!hasWindow()) return;
  if (reconnectTimer !== null || reconnectInFlight) return;
  if (!shouldScheduleReconnect()) return;

  const delayMs = getReconnectDelayMs(reconnectAttempt);
  reconnectAttempt += 1;
  reconnectTimer = window.setTimeout(() => {
    reconnectTimer = null;
    void runReconnect();
  }, delayMs);
}

async function runReconnect() {
  if (reconnectInFlight) return;
  if (!shouldScheduleReconnect()) return;

  reconnectInFlight = true;
  setWsState('connecting');

  const connected = await connectToAnyWsUrl();
  if (!(connected as any)?.ok) {
    reconnectInFlight = false;
    setWsState('disconnected');
    scheduleReconnect();
    return;
  }

  const token = getSessionToken();
  if (!token) {
    reconnectInFlight = false;
    setWsState('connected');
    return;
  }

  const session = await authSessionByToken(token);
  if (!(session as any)?.ok) {
    reconnectInFlight = false;
    setWsState('disconnected');

    if ((session as any)?.error === 'unauthorized') {
      emit('ws:session-expired');
      return;
    }

    scheduleReconnect();
    return;
  }

  const dialogId = await joinActiveDialogAfterReconnect();
  reconnectInFlight = false;
  resetReconnectAttempts();
  setWsState('connected');
  emit('ws:reconnected', {dialogId});
}

function onWsConnected() {
  reconnectInFlight = false;
  clearReconnectTimer();
  resetReconnectAttempts();
  setWsState('connected');
}

function onWsDisconnected() {
  setWsState('disconnected');
  scheduleReconnect();
}

function initReconnectRuntime() {
  if (!hasWindow()) return;
  if (reconnectHooksReady) return;

  reconnectHooksReady = true;
  on('ws:connected', onWsConnected);
  on('ws:disconnected', onWsDisconnected);

  if (ws.socket?.readyState === WebSocket.OPEN) {
    setWsState('connected');
  }
}

export function setWsReconnectDialogResolver(resolver: (() => number | null) | null) {
  reconnectDialogResolver = resolver;
}

export function getSessionToken() {
  if (!hasWindow()) return '';
  return localStorage.getItem(SESSION_TOKEN_KEY) || '';
}

export function setSessionToken(token: string) {
  if (!hasWindow()) return;
  localStorage.setItem(SESSION_TOKEN_KEY, token);
}

export function clearSessionToken() {
  if (!hasWindow()) return;
  localStorage.removeItem(SESSION_TOKEN_KEY);
}

export async function ensureWsConnected() {
  initReconnectRuntime();

  if (ws.socket?.readyState === WebSocket.OPEN) {
    setWsState('connected');
    return {ok: true};
  }

  setWsState('connecting');
  const connected = await connectToAnyWsUrl();
  if ((connected as any)?.ok) {
    setWsState('connected');
    return connected;
  }

  setWsState('disconnected');
  return connected;
}

export async function restoreSession() {
  const connected = await ensureWsConnected();
  if (!(connected as any).ok) return connected;

  const token = getSessionToken();
  if (!token) {
    return {ok: false, error: 'unauthorized'};
  }

  return authSessionByToken(token);
}

export async function wsLogin(nickname: string, password: string) {
  const connected = await ensureWsConnected();
  if (!(connected as any).ok) return connected;

  const normalizedNickname = String(nickname || '').trim().toLowerCase();
  const result = await ws.request('auth:login', {nickname: normalizedNickname, password});
  if ((result as any)?.ok && (result as any)?.token) {
    setSessionToken((result as any).token);
  }
  return result;
}

export async function wsRedeemInvite(code: string, nickname: string, password: string) {
  const connected = await ensureWsConnected();
  if (!(connected as any).ok) return connected;

  const normalizedNickname = String(nickname || '').trim().toLowerCase();
  const result = await ws.request('invites:redeem', {code, nickname: normalizedNickname, password});
  if ((result as any)?.ok && (result as any)?.token) {
    setSessionToken((result as any).token);
  }
  return result;
}

export async function wsCheckInvite(code: string) {
  const connected = await ensureWsConnected();
  if (!(connected as any).ok) return connected;
  return ws.request('invites:check', {code});
}

export async function wsLogout() {
  const connected = await ensureWsConnected();
  if ((connected as any).ok) {
    await ws.request('auth:logout');
  }
  clearSessionToken();
  stopReconnectLoop();
  setWsState('disconnected');
  ws.disconnect();
}

export async function wsUpdateProfile(payload: {name?: string; nicknameColor?: string | null}) {
  const connected = await ensureWsConnected();
  if (!(connected as any).ok) return connected;
  return ws.request('auth:updateProfile', payload);
}

export async function wsChangePassword(newPassword: string) {
  const connected = await ensureWsConnected();
  if (!(connected as any).ok) return connected;
  return ws.request('auth:changePassword', {newPassword});
}
