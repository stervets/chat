export type WebPushPermission = 'default' | 'denied' | 'granted';

export type WebPushDiagEvent = {
  ts: string;
  level: 'info' | 'warn';
  stage: string;
  details?: Record<string, unknown>;
};

export type WebPushServerConfig = {
  ok: true;
  enabled: false;
  vapidPublicKey: '';
};

export type WebPushSubscribeResult = {
  ok: false;
  error: 'web_push_disabled';
  details?: Record<string, unknown>;
};

export type WebPushUnsubscribeResult = {
  ok: true;
  removed: 0;
};

export type WebPushTestResult = {
  ok: false;
  error: 'web_push_disabled';
};

export function isStandaloneDisplayMode() {
  return false;
}

export function isWebPushSupported() {
  return false;
}

export function isIosForWebPush() {
  return false;
}

export function getWebPushPermission(): WebPushPermission {
  return 'default';
}

export async function fetchWebPushServerConfig(): Promise<WebPushServerConfig> {
  return {
    ok: true,
    enabled: false,
    vapidPublicKey: '',
  };
}

export async function subscribeWebPush(
  _apiBase: string,
  _sessionToken: string,
  _vapidPublicKey: string,
): Promise<WebPushSubscribeResult> {
  return {
    ok: false,
    error: 'web_push_disabled',
  };
}

export async function unsubscribeWebPush(
  _apiBase: string,
  _sessionToken: string,
): Promise<WebPushUnsubscribeResult> {
  return {
    ok: true,
    removed: 0,
  };
}

export async function sendWebPushTest(
  _apiBase: string,
  _sessionToken: string,
): Promise<WebPushTestResult> {
  return {
    ok: false,
    error: 'web_push_disabled',
  };
}
