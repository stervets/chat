export type WebPushPermission = 'default' | 'denied' | 'granted';

export type WebPushServerConfig = {
  enabled: boolean;
  vapidPublicKey: string;
};

export type WebPushTestError = {
  subscriptionId: number;
  userId: number;
  endpointShort: string;
  statusCode: number;
  message: string;
  removed: boolean;
};

export type WebPushTestResult = {
  ok: true;
  totalSubscriptions: number;
  successCount: number;
  errorCount: number;
  errors: WebPushTestError[];
} | {
  ok: false;
  error: string;
};

type WebPushSyncResult = {
  ok: true;
} | {
  ok: false;
  error: 'invalid_subscription_payload' | 'unauthorized' | 'request_failed' | 'http_error';
  statusCode: number;
  message: string;
};

export type WebPushSubscribeResult = {
  ok: true;
  reusedExistingSubscription: boolean;
} | {
  ok: false;
  error: 'invalid_vapid_key' | 'service_worker_ready_failed' | 'get_subscription_failed' | 'subscribe_failed' | 'sync_failed';
  details: string;
};

export type WebPushDiagEvent = {
  level: 'info' | 'warn';
  stage: string;
  details?: Record<string, unknown>;
};

type WebPushDiagReporter = (event: WebPushDiagEvent) => void;

function logWebPushInfo(stage: string, detailsRaw?: Record<string, unknown>, diag?: WebPushDiagReporter) {
  if (!diag) return;
  if (detailsRaw) {
    console.info(`[web-push] ${stage}`, detailsRaw);
    diag?.({level: 'info', stage, details: detailsRaw});
    return;
  }
  console.info(`[web-push] ${stage}`);
  diag?.({level: 'info', stage});
}

function logWebPushWarn(stage: string, detailsRaw?: Record<string, unknown>, diag?: WebPushDiagReporter) {
  if (!diag) return;
  if (detailsRaw) {
    console.warn(`[web-push] ${stage}`, detailsRaw);
    diag?.({level: 'warn', stage, details: detailsRaw});
    return;
  }
  console.warn(`[web-push] ${stage}`);
  diag?.({level: 'warn', stage});
}

function normalizeErrorText(errorRaw: unknown) {
  const text = String((errorRaw as any)?.message || errorRaw || '').replace(/\s+/g, ' ').trim();
  return text || 'unknown_error';
}

function shortEndpoint(endpointRaw: unknown) {
  const endpoint = String(endpointRaw || '').trim();
  if (!endpoint) return 'empty';
  if (endpoint.length <= 40) return endpoint;
  return `${endpoint.slice(0, 18)}...${endpoint.slice(-12)}`;
}

function base64UrlToUint8Array(valueRaw: unknown, diag?: WebPushDiagReporter) {
  const value = String(valueRaw || '').trim();
  if (!value) return new Uint8Array();

  try {
    const normalized = value
      .replace(/-/g, '+')
      .replace(/_/g, '/');
    const withPadding = normalized + '='.repeat((4 - normalized.length % 4) % 4);
    const decoded = atob(withPadding);
    const output = new Uint8Array(decoded.length);

    for (let index = 0; index < decoded.length; index += 1) {
      output[index] = decoded.charCodeAt(index);
    }

    return output;
  } catch (error: any) {
    logWebPushWarn('vapid decode failed', {
      message: normalizeErrorText(error),
    }, diag);
    return new Uint8Array();
  }
}

function uint8ArraysEqual(leftRaw: Uint8Array, rightRaw: Uint8Array) {
  const left = leftRaw || new Uint8Array();
  const right = rightRaw || new Uint8Array();
  if (left.length !== right.length) return false;

  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }

  return true;
}

function isSubscriptionBoundToVapidKey(subscription: PushSubscription, applicationServerKey: Uint8Array) {
  if (!applicationServerKey.length) return false;

  const rawKey = (subscription as any)?.options?.applicationServerKey;
  if (!rawKey) return true;

  try {
    const currentKey = new Uint8Array(rawKey as ArrayBuffer);
    return uint8ArraysEqual(currentKey, applicationServerKey);
  } catch {
    return true;
  }
}

function serializePushSubscription(subscription: PushSubscription) {
  const json = subscription.toJSON();
  const endpoint = String(json.endpoint || '').trim();
  const p256dh = String(json.keys?.p256dh || '').trim();
  const auth = String(json.keys?.auth || '').trim();

  if (!endpoint || !p256dh || !auth) return null;

  return {
    endpoint,
    keys: {
      p256dh,
      auth,
    },
  };
}

export function isWebPushSupported() {
  if (typeof window === 'undefined') return false;
  if (!('serviceWorker' in navigator)) return false;
  if (!('PushManager' in window)) return false;
  if (!('Notification' in window)) return false;
  return true;
}

export function getWebPushPermission() {
  if (typeof Notification === 'undefined') return 'denied' as WebPushPermission;
  const permission = Notification.permission;
  if (permission === 'granted' || permission === 'denied' || permission === 'default') {
    return permission as WebPushPermission;
  }
  return 'default' as WebPushPermission;
}

export function isIosForWebPush() {
  if (typeof navigator === 'undefined') return false;
  const userAgent = navigator.userAgent || '';
  const platform = navigator.platform || '';
  const maxTouchPoints = Number((navigator as any).maxTouchPoints || 0);
  if (/iPad|iPhone|iPod/i.test(userAgent)) return true;
  return platform === 'MacIntel' && maxTouchPoints > 1;
}

export function isStandaloneDisplayMode() {
  if (typeof window === 'undefined') return false;
  const byDisplayMode = window.matchMedia('(display-mode: standalone)').matches;
  const byNavigator = Boolean((navigator as any).standalone);
  return byDisplayMode || byNavigator;
}

async function resolveActiveServiceWorkerRegistration(diag?: WebPushDiagReporter) {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
    logWebPushWarn('service worker api not available', undefined, diag);
    return null;
  }

  try {
    const existing = await navigator.serviceWorker.getRegistration('/');
    if (existing) {
      logWebPushInfo('service worker registration found', {
        scope: existing.scope,
        active: !!existing.active,
        installing: !!existing.installing,
        waiting: !!existing.waiting,
      }, diag);
    } else {
      logWebPushInfo('service worker registration not found, registering /sw.js', undefined, diag);
      await navigator.serviceWorker.register('/sw.js');
      logWebPushInfo('service worker register success', {
        scriptUrl: '/sw.js',
      }, diag);
    }
  } catch (error: any) {
    logWebPushWarn('service worker register failed', {
      message: normalizeErrorText(error),
    }, diag);
    return null;
  }

  try {
    const ready = await navigator.serviceWorker.ready;
    logWebPushInfo('service worker ready success', {
      scope: ready.scope,
      active: !!ready.active,
      scriptURL: String((ready.active as any)?.scriptURL || '').trim() || null,
    }, diag);
    return ready;
  } catch (error: any) {
    logWebPushWarn('service worker ready failed', {
      message: normalizeErrorText(error),
    }, diag);
    return null;
  }
}

export async function fetchWebPushServerConfig(apiBase: string): Promise<WebPushServerConfig> {
  try {
    const response = await fetch(`${apiBase}/push/public-key`, {
      method: 'GET',
    });
    if (!response.ok) {
      return {enabled: false, vapidPublicKey: ''};
    }

    const payload = await response.json() as {enabled?: boolean; vapidPublicKey?: string};
    const vapidPublicKey = String(payload?.vapidPublicKey || '').trim();
    return {
      enabled: !!payload?.enabled && !!vapidPublicKey,
      vapidPublicKey,
    };
  } catch {
    return {enabled: false, vapidPublicKey: ''};
  }
}

export async function syncWebPushSubscription(apiBase: string, token: string, subscription: PushSubscription, diag?: WebPushDiagReporter): Promise<WebPushSyncResult> {
  const normalizedToken = String(token || '').trim();
  const payload = serializePushSubscription(subscription);
  if (!payload) {
    logWebPushWarn('push subscribe sync skipped: invalid payload', undefined, diag);
    return {
      ok: false,
      error: 'invalid_subscription_payload',
      statusCode: 0,
      message: 'invalid_subscription_payload',
    };
  }
  if (!normalizedToken) {
    logWebPushWarn('push subscribe sync skipped: unauthorized', undefined, diag);
    return {
      ok: false,
      error: 'unauthorized',
      statusCode: 401,
      message: 'unauthorized',
    };
  }

  logWebPushInfo('push subscribe sync request', {
    endpoint: shortEndpoint(payload.endpoint),
  }, diag);

  try {
    const response = await fetch(`${apiBase}/push/subscribe`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${normalizedToken}`,
      },
      body: JSON.stringify(payload),
    });

    const result = await response.json().catch(() => ({}));
    if (!response.ok || !(result as any)?.ok) {
      const errorText = String((result as any)?.error || `http_${response.status}`).trim() || 'request_failed';
      logWebPushWarn('push subscribe sync failed', {
        statusCode: response.status,
        endpoint: shortEndpoint(payload.endpoint),
        error: errorText,
      }, diag);
      return {
        ok: false,
        error: 'http_error',
        statusCode: response.status,
        message: errorText,
      };
    }

    logWebPushInfo('push subscribe sync success', {
      statusCode: response.status,
      endpoint: shortEndpoint(payload.endpoint),
    }, diag);
    return {ok: true};
  } catch (error: any) {
    const message = normalizeErrorText(error);
    logWebPushWarn('push subscribe sync failed', {
      statusCode: 0,
      endpoint: shortEndpoint(payload.endpoint),
      error: message,
    }, diag);
    return {
      ok: false,
      error: 'request_failed',
      statusCode: 0,
      message,
    };
  }
}

export async function sendWebPushTest(apiBase: string, token: string): Promise<WebPushTestResult> {
  const normalizedToken = String(token || '').trim();
  if (!normalizedToken) {
    return {ok: false, error: 'unauthorized'};
  }

  try {
    const response = await fetch(`${apiBase}/push/test`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${normalizedToken}`,
      },
    });
    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      const error = String((payload as any)?.error || `http_${response.status}`).trim();
      return {ok: false, error: error || 'request_failed'};
    }

    if (!(payload as any)?.ok) {
      const error = String((payload as any)?.error || 'request_failed').trim();
      return {ok: false, error: error || 'request_failed'};
    }

    const errors = Array.isArray((payload as any)?.errors) ? (payload as any).errors : [];
    return {
      ok: true,
      totalSubscriptions: Number((payload as any)?.totalSubscriptions || 0),
      successCount: Number((payload as any)?.successCount || 0),
      errorCount: Number((payload as any)?.errorCount || 0),
      errors: errors.map((item: any) => ({
        subscriptionId: Number(item?.subscriptionId || 0),
        userId: Number(item?.userId || 0),
        endpointShort: String(item?.endpointShort || '').trim(),
        statusCode: Number(item?.statusCode || 0),
        message: String(item?.message || '').trim(),
        removed: !!item?.removed,
      })),
    };
  } catch {
    return {ok: false, error: 'request_failed'};
  }
}

export async function subscribeWebPush(
  apiBase: string,
  token: string,
  vapidPublicKey: string,
  diag?: WebPushDiagReporter,
): Promise<WebPushSubscribeResult> {
  const normalizedToken = String(token || '').trim();
  logWebPushInfo('subscribe flow started', {
    permission: getWebPushPermission(),
    hasToken: !!normalizedToken,
  }, diag);

  const applicationServerKey = base64UrlToUint8Array(vapidPublicKey, diag);
  if (!applicationServerKey.length) {
    return {
      ok: false,
      error: 'invalid_vapid_key',
      details: 'invalid_vapid_key',
    };
  }

  const registration = await resolveActiveServiceWorkerRegistration(diag);
  if (!registration) {
    return {
      ok: false,
      error: 'service_worker_ready_failed',
      details: 'service_worker_ready_failed',
    };
  }

  let subscription: PushSubscription | null = null;
  try {
    subscription = await registration.pushManager.getSubscription();
    logWebPushInfo('pushManager.getSubscription resolved', {
      hasSubscription: !!subscription,
      endpoint: shortEndpoint((subscription as any)?.endpoint),
    }, diag);
  } catch (error: any) {
    const details = normalizeErrorText(error);
    logWebPushWarn('pushManager.getSubscription failed', {error: details}, diag);
    return {
      ok: false,
      error: 'get_subscription_failed',
      details,
    };
  }

  let reusedExistingSubscription = !!subscription;
  if (subscription && !isSubscriptionBoundToVapidKey(subscription, applicationServerKey)) {
    logWebPushInfo('existing subscription bound to different VAPID key, unsubscribing', undefined, diag);
    await subscription.unsubscribe().catch(() => false);
    subscription = null;
    reusedExistingSubscription = false;
  }

  if (!subscription) {
    try {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey,
      });
      logWebPushInfo('pushManager.subscribe success', {
        endpoint: shortEndpoint(subscription.endpoint),
      }, diag);
    } catch (error: any) {
      const details = normalizeErrorText(error);
      logWebPushWarn('pushManager.subscribe failed', {
        error: details,
      }, diag);
      return {
        ok: false,
        error: 'subscribe_failed',
        details,
      };
    }
  } else {
    logWebPushInfo('reusing existing push subscription', {
      endpoint: shortEndpoint(subscription.endpoint),
    }, diag);
  }

  const synced = await syncWebPushSubscription(apiBase, normalizedToken, subscription, diag);
  if (!synced.ok) {
    return {
      ok: false,
      error: 'sync_failed',
      details: synced.message,
    };
  }

  logWebPushInfo('subscribe flow completed', {
    reusedExistingSubscription,
    endpoint: shortEndpoint(subscription.endpoint),
  }, diag);
  return {
    ok: true,
    reusedExistingSubscription,
  };
}

export async function unsubscribeWebPush(apiBase: string, token: string) {
  const normalizedToken = String(token || '').trim();
  const registration = await resolveActiveServiceWorkerRegistration();
  if (!registration) {
    logWebPushWarn('unsubscribe skipped: no active service worker registration');
    return {ok: true} as const;
  }

  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) return {ok: true} as const;

  const payload = serializePushSubscription(subscription);
  if (payload && normalizedToken) {
    try {
      await fetch(`${apiBase}/push/unsubscribe`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${normalizedToken}`,
        },
        body: JSON.stringify({endpoint: payload.endpoint}),
      });
    } catch {
      // no-op
    }
  }

  await subscription.unsubscribe().catch(() => false);
  return {ok: true} as const;
}
