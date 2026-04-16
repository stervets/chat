import {getWsUrlCandidates} from '@/composables/api';
import {ws} from '@/composables/classes/ws';

const SESSION_TOKEN_KEY = 'marx_session_token';

const hasWindow = () => typeof window !== 'undefined';

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

export async function restoreSession() {
  const connected = await ensureWsConnected();
  if (!(connected as any).ok) return connected;

  const token = getSessionToken();
  if (!token) {
    return {ok: false, error: 'unauthorized'};
  }

  const result = await ws.request('auth:session', token);
  if ((result as any)?.ok) {
    return result;
  }

  clearSessionToken();
  return {ok: false, error: 'unauthorized'};
}

export async function wsLogin(nickname: string, password: string) {
  const connected = await ensureWsConnected();
  if (!(connected as any).ok) return connected;

  const result = await ws.request('auth:login', {nickname, password});
  if ((result as any)?.ok && (result as any)?.token) {
    setSessionToken((result as any).token);
  }
  return result;
}

export async function wsRedeemInvite(code: string, nickname: string, password: string) {
  const connected = await ensureWsConnected();
  if (!(connected as any).ok) return connected;

  const result = await ws.request('invites:redeem', {code, nickname, password});
  if ((result as any)?.ok && (result as any)?.token) {
    setSessionToken((result as any).token);
  }
  return result;
}

export async function wsLogout() {
  const connected = await ensureWsConnected();
  if ((connected as any).ok) {
    await ws.request('auth:logout');
  }
  clearSessionToken();
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
