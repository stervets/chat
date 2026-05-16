import {ref} from 'vue';
import {getWsUrlCandidates} from '@/composables/api';
import {ws, type WsResult} from '@/composables/classes/ws';
import {emit, on} from '@/composables/event-bus';
import {getStoredRuStorePushToken} from '@/composables/rustore-push';
import {isNativeAndroidApp} from '@/composables/native-runtime';

const SESSION_TOKEN_KEY = 'marx_session_token';
const RESERVE_CHANNEL_ENABLED_KEY = 'marx_reserve_channel_enabled';
const RESERVE_CHANNEL_NO_PROMPT_KEY = 'marx_reserve_channel_no_prompt';
const RECONNECT_BASE_DELAY_MS = 500;
const RECONNECT_MAX_DELAY_MS = 12000;
const RESERVE_PROMPT_COOLDOWN_MS = 120000;

type ReservePromptAction = 'yes' | 'no' | 'never';

type ReservePromptPayload = {
  id: string;
};

type ReserveRuntimeConfig = {
  available: boolean;
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

const hasWindow = () => typeof window !== 'undefined';

type WsConnectionState = 'disconnected' | 'connecting' | 'connected';

export function wsData<T>(result: any, fallback: T): T {
  return result && result.ok === true && Object.prototype.hasOwnProperty.call(result, 'data')
    ? result.data as T
    : fallback;
}

export function wsObject(result: any): Record<string, any> {
  const data = wsData<Record<string, any>>(result, {});
  return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
}

export function wsError(result: any, fallback = 'unknown') {
  const error = result?.error;
  if (typeof error === 'string') return error || fallback;
  if (error && typeof error === 'object') {
    return String(error.message || error.code || fallback);
  }
  return fallback;
}

export const wsConnectionState = ref<WsConnectionState>('disconnected');

let reconnectHooksReady = false;
let reconnectAttempt = 0;
let reconnectTimer: number | null = null;
let reconnectInFlight = false;
let reconnectRoomResolver: (() => number | null) | null = null;

let reservePromptInFlight = false;
let reservePromptLastAt = 0;
const reservePromptResolvers = new Map<string, (action: ReservePromptAction) => void>();

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

function parseReconnectRoomId() {
  const roomId = Number(reconnectRoomResolver?.() || 0);
  if (!Number.isFinite(roomId) || roomId <= 0) return null;
  return roomId;
}

async function joinActiveRoomAfterReconnect() {
  const roomId = parseReconnectRoomId();
  if (!roomId) return null;

  const result = await ws.request('room:get', {roomId});
  if (!(result as any)?.ok) return null;
  return roomId;
}

function getReserveRuntimeConfig(): ReserveRuntimeConfig {
  const defaults = {
    deviceType: 'WEB',
    locale: 'ru',
    deviceLocale: 'ru',
    osVersion: 'Linux',
    deviceName: 'Chrome',
    headerUserAgent: hasWindow() ? window.navigator.userAgent : 'Mozilla/5.0',
    appVersion: '26.5.8',
    screen: hasWindow()
      ? `${Math.max(window.screen?.width || 0, 1)}x${Math.max(window.screen?.height || 0, 1)} ${Number(window.devicePixelRatio || 1).toFixed(1)}x`
      : '1440x2560 1.0x',
    timezone: hasWindow()
      ? (Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Moscow')
      : 'Europe/Moscow',
  };

  try {
    if (!isNativeAndroidApp()) {
      return {
        available: false,
        wsUrl: '',
        token: '',
        deviceId: '',
        chatId: 0,
        backendPublicKeyPem: '',
        userAgent: defaults,
      };
    }

    const runtimeConfig = useRuntimeConfig();
    const source = ((runtimeConfig.public as any)?.maxReserve || {}) as Record<string, any>;
    const rawUserAgent = source.userAgent && typeof source.userAgent === 'object' ? source.userAgent : {};

    const wsUrl = String(source.wsUrl || '').trim();
    const token = String(source.token || '').trim();
    const deviceId = String(source.deviceId || '').trim();
    const backendPublicKeyPem = String(source.backendPublicKeyPem || '').trim();
    const chatId = Number(source.chatId || 0);

    const availableByConfig = source.enabled === true || source.available === true;
    const requiredFilled = !!wsUrl && !!token && !!deviceId && !!backendPublicKeyPem;

    return {
      available: availableByConfig && requiredFilled,
      wsUrl,
      token,
      deviceId,
      chatId: Number.isFinite(chatId) ? chatId : 0,
      backendPublicKeyPem,
      userAgent: {
        deviceType: String(rawUserAgent.deviceType || defaults.deviceType).trim() || defaults.deviceType,
        locale: String(rawUserAgent.locale || defaults.locale).trim() || defaults.locale,
        deviceLocale: String(rawUserAgent.deviceLocale || defaults.deviceLocale).trim() || defaults.deviceLocale,
        osVersion: String(rawUserAgent.osVersion || defaults.osVersion).trim() || defaults.osVersion,
        deviceName: String(rawUserAgent.deviceName || defaults.deviceName).trim() || defaults.deviceName,
        headerUserAgent: String(rawUserAgent.headerUserAgent || defaults.headerUserAgent).trim() || defaults.headerUserAgent,
        appVersion: String(rawUserAgent.appVersion || defaults.appVersion).trim() || defaults.appVersion,
        screen: String(rawUserAgent.screen || defaults.screen).trim() || defaults.screen,
        timezone: String(rawUserAgent.timezone || defaults.timezone).trim() || defaults.timezone,
      },
    };
  } catch {
    return {
      available: false,
      wsUrl: '',
      token: '',
      deviceId: '',
      chatId: 0,
      backendPublicKeyPem: '',
      userAgent: defaults,
    };
  }
}

function syncReserveTransportConfig() {
  const reserveConfig = getReserveRuntimeConfig();
  if (!reserveConfig.available) {
    ws.setReserveConfig(null);
    ws.setReserveActive(false);
    return reserveConfig;
  }

  ws.setReserveConfig({
    wsUrl: reserveConfig.wsUrl,
    token: reserveConfig.token,
    deviceId: reserveConfig.deviceId,
    chatId: reserveConfig.chatId,
    backendPublicKeyPem: reserveConfig.backendPublicKeyPem,
    userAgent: reserveConfig.userAgent,
  });
  return reserveConfig;
}

function getReserveChannelEnabled() {
  if (!hasWindow()) return false;
  return localStorage.getItem(RESERVE_CHANNEL_ENABLED_KEY) === '1';
}

function setReserveChannelEnabled(enabledRaw: boolean) {
  if (!hasWindow()) return;
  const enabled = !!enabledRaw;
  localStorage.setItem(RESERVE_CHANNEL_ENABLED_KEY, enabled ? '1' : '0');
  if (enabled) {
    localStorage.setItem(RESERVE_CHANNEL_NO_PROMPT_KEY, '0');
  }
  if (!enabled) {
    ws.setReserveActive(false);
  }
}

function getReserveChannelNoPrompt() {
  if (!hasWindow()) return false;
  return localStorage.getItem(RESERVE_CHANNEL_NO_PROMPT_KEY) === '1';
}

function setReserveChannelNoPrompt(valueRaw: boolean) {
  if (!hasWindow()) return;
  localStorage.setItem(RESERVE_CHANNEL_NO_PROMPT_KEY, valueRaw ? '1' : '0');
}

function canPromptReserveChannel() {
  if (!hasWindow()) return false;
  if (reservePromptInFlight) return false;
  if (getReserveChannelNoPrompt()) return false;
  if (Date.now() - reservePromptLastAt < RESERVE_PROMPT_COOLDOWN_MS) return false;
  return true;
}

function reservePromptId() {
  return `reserve-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

async function showReservePrompt() {
  if (!canPromptReserveChannel()) return 'no' as ReservePromptAction;
  reservePromptInFlight = true;
  reservePromptLastAt = Date.now();

  const id = reservePromptId();
  const result = await new Promise<ReservePromptAction>((resolve) => {
    reservePromptResolvers.set(id, resolve);
    emit('reserve:prompt:show', {id} satisfies ReservePromptPayload);
    window.setTimeout(() => {
      const resolver = reservePromptResolvers.get(id);
      if (!resolver) return;
      reservePromptResolvers.delete(id);
      resolver('no');
    }, 60000);
  });

  reservePromptInFlight = false;
  return result;
}

export function resolveReservePromptAction(idRaw: string, actionRaw: string) {
  const id = String(idRaw || '').trim();
  if (!id) return;
  const resolver = reservePromptResolvers.get(id);
  if (!resolver) return;
  reservePromptResolvers.delete(id);

  const normalized = String(actionRaw || '').trim().toLowerCase();
  if (normalized === 'yes') {
    resolver('yes');
    return;
  }
  if (normalized === 'never') {
    resolver('never');
    return;
  }
  resolver('no');
}

async function tryEnableReserveByPrompt() {
  const reserveConfig = syncReserveTransportConfig();
  if (!reserveConfig.available) return false;
  if (getReserveChannelEnabled()) return true;

  const decision = await showReservePrompt();
  if (decision === 'never') {
    setReserveChannelNoPrompt(true);
    return false;
  }
  if (decision === 'yes') {
    setReserveChannelEnabled(true);
    setReserveChannelNoPrompt(false);
    console.info('[ws-route] reserve enabled by prompt');
    return true;
  }
  return false;
}

async function connectToAnyWsUrl() {
  const reserveConfig = syncReserveTransportConfig();

  ws.setReserveActive(false);

  const wsUrls = getWsUrlCandidates();
  if (!wsUrls.length) {
    if (reserveConfig.available && getReserveChannelEnabled()) {
      ws.setReserveActive(true);
      try {
        await ws.connectReserve();
        return {ok: true};
      } catch (err: any) {
        ws.setReserveActive(false);
        return {ok: false, error: String(err?.message || err || 'reserve_connect_error')};
      }
    }
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

  if (reserveConfig.available && getReserveChannelEnabled()) {
    ws.setReserveActive(true);
    try {
      console.info('[ws-route] connect via reserve');
      await ws.connectReserve();
      return {ok: true};
    } catch (err: any) {
      ws.setReserveActive(false);
      lastError = String(err?.message || err || 'reserve_connect_error');
    }
  }

  return {ok: false, error: lastError || 'ws_connect_error'};
}

async function authSessionByToken(token: string) {
  const result = await ws.request('auth:session', {token});
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

    const prompted = await tryEnableReserveByPrompt();
    if (prompted) {
      void runReconnect();
      return;
    }

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

  const roomId = await joinActiveRoomAfterReconnect();
  reconnectInFlight = false;
  resetReconnectAttempts();
  setWsState('connected');
  emit('ws:reconnected', {roomId});
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

  if (ws.isConnected()) {
    setWsState('connected');
  }
}

export function setWsReconnectDialogResolver(resolver: (() => number | null) | null) {
  reconnectRoomResolver = resolver;
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

export function isReserveChannelEnabled() {
  return getReserveChannelEnabled();
}

export function setReserveChannelEnabledByUser(enabledRaw: boolean) {
  const reserveConfig = syncReserveTransportConfig();
  if (!reserveConfig.available && enabledRaw) {
    setReserveChannelEnabled(false);
    return false;
  }
  setReserveChannelEnabled(enabledRaw);
  return !!enabledRaw;
}

export function isReserveChannelAvailable() {
  const reserveConfig = syncReserveTransportConfig();
  return reserveConfig.available;
}

export function isReserveChannelNoPrompt() {
  return getReserveChannelNoPrompt();
}

export function setReserveChannelNoPromptByUser(valueRaw: boolean) {
  setReserveChannelNoPrompt(valueRaw);
}

export async function forceWsReconnect(reason = 'manual') {
  initReconnectRuntime();
  clearReconnectTimer();
  reconnectInFlight = false;
  resetReconnectAttempts();
  ws.disconnect();

  if (!getSessionToken()) {
    setWsState('disconnected');
    return {ok: false, error: 'unauthorized', reason};
  }

  setWsState('connecting');
  void runReconnect();
  return {ok: true, reason};
}

export async function ensureWsConnected() {
  initReconnectRuntime();

  if (ws.isConnected()) {
    setWsState('connected');
    return {ok: true};
  }

  setWsState('connecting');
  const connected = await connectToAnyWsUrl();
  if ((connected as any)?.ok) {
    setWsState('connected');
    return connected;
  }

  const prompted = await tryEnableReserveByPrompt();
  if (prompted) {
    const retried = await connectToAnyWsUrl();
    if ((retried as any)?.ok) {
      setWsState('connected');
      return retried;
    }
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
  console.info(`[ws-route] login nickname=${normalizedNickname}`);
  const result = await ws.request('auth:login', {nickname: normalizedNickname, password});
  const data = wsObject(result);
  if ((result as any)?.ok && data.token) {
    setSessionToken(data.token);
  }
  return result;
}

export async function wsRedeemInvite(code: string, nickname: string, password: string) {
  const connected = await ensureWsConnected();
  if (!(connected as any).ok) return connected;

  const normalizedNickname = String(nickname || '').trim().toLowerCase();
  const result = await ws.request('invites:redeem', {code, nickname: normalizedNickname, password});
  const data = wsObject(result);
  if ((result as any)?.ok && data.token) {
    setSessionToken(data.token);
  }
  return result;
}

export async function wsCheckInvite(code: string) {
  const connected = await ensureWsConnected();
  if (!(connected as any).ok) return connected;
  return ws.request('invites:check', {code});
}

export async function wsLogout() {
  const nativePushToken = getStoredRuStorePushToken();
  const connected = await ensureWsConnected();
  if ((connected as any).ok) {
    if (nativePushToken) {
      await ws.request('push:native:unregister', {
        provider: 'rustore',
        token: nativePushToken,
        platform: 'android',
      });
    }
    await ws.request('auth:logout');
  }
  clearSessionToken();
  stopReconnectLoop();
  setWsState('disconnected');
  ws.disconnect();
}

export async function wsUpdateProfile(payload: {
  name?: string;
  info?: string | null;
  avatarPath?: string | null;
  nicknameColor?: string | null;
  pushDisableAllMentions?: boolean;
}) {
  const connected = await ensureWsConnected();
  if (!(connected as any).ok) return connected;
  return ws.request('auth:updateProfile', payload);
}

export async function wsChangePassword(newPassword: string) {
  const connected = await ensureWsConnected();
  if (!(connected as any).ok) return connected;
  return ws.request('auth:changePassword', {newPassword});
}

export async function wsSetVpnDonation(sent: boolean) {
  const session = await restoreSession();
  if (!(session as any)?.ok) return session;
  return ws.request('public:vpnDonation', {sent: !!sent});
}

export async function wsProvisionVpn() {
  const session = await restoreSession();
  if (!(session as any)?.ok) return session;
  return ws.request('public:vpnProvision');
}

export async function wsGamesSoloCreate(moduleKey = 'king') {
  const session = await restoreSession();
  if (!(session as any)?.ok) return session;
  return ws.request('game:session:create-solo', {moduleKey});
}

export async function wsGamesSessionGet(sessionId: number) {
  const session = await restoreSession();
  if (!(session as any)?.ok) return session;
  return ws.request('game:session:get', {sessionId});
}

export async function wsGamesAction(sessionId: number, action: {type: string; payload?: any}) {
  const session = await restoreSession();
  if (!(session as any)?.ok) return session;
  return ws.request('game:session:action', {sessionId, action});
}

export async function wsRegisterNativePushToken(tokenRaw: string, providerRaw = 'rustore', platformRaw = 'android') {
  const session = await restoreSession();
  if (!(session as any)?.ok) return session;

  const token = String(tokenRaw || '').trim();
  const provider = String(providerRaw || 'rustore').trim().toLowerCase() || 'rustore';
  const platform = String(platformRaw || 'android').trim().toLowerCase() || 'android';
  if (!token) {
    return {ok: false, error: 'invalid_token'} as const;
  }

  return ws.request('push:native:register', {provider, token, platform});
}

export async function wsUnregisterNativePushToken(tokenRaw: string, providerRaw = 'rustore', platformRaw = 'android') {
  const session = await restoreSession();
  if (!(session as any)?.ok) return session;

  const token = String(tokenRaw || '').trim();
  const provider = String(providerRaw || 'rustore').trim().toLowerCase() || 'rustore';
  const platform = String(platformRaw || 'android').trim().toLowerCase() || 'android';
  if (!token) {
    return {ok: false, error: 'invalid_token'} as const;
  }

  return ws.request('push:native:unregister', {provider, token, platform});
}
