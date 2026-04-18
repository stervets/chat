export type WebPushPermission = 'default' | 'denied' | 'granted';

export type WebPushServerConfig = {
  enabled: boolean;
  vapidPublicKey: string;
};

function base64UrlToUint8Array(valueRaw: unknown) {
  const value = String(valueRaw || '').trim();
  if (!value) return new Uint8Array();

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

export async function syncWebPushSubscription(apiBase: string, token: string, subscription: PushSubscription) {
  const payload = serializePushSubscription(subscription);
  if (!payload) return false;
  if (!token) return false;

  try {
    const response = await fetch(`${apiBase}/push/subscribe`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) return false;
    const result = await response.json();
    return !!(result as any)?.ok;
  } catch {
    return false;
  }
}

export async function subscribeWebPush(apiBase: string, token: string, vapidPublicKey: string) {
  const applicationServerKey = base64UrlToUint8Array(vapidPublicKey);
  if (!applicationServerKey.length) return {ok: false, error: 'invalid_vapid_key'} as const;

  const registration = await navigator.serviceWorker.ready;

  let subscription = await registration.pushManager.getSubscription();
  if (subscription && !isSubscriptionBoundToVapidKey(subscription, applicationServerKey)) {
    await subscription.unsubscribe().catch(() => false);
    subscription = null;
  }

  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey,
    });
  }

  const synced = await syncWebPushSubscription(apiBase, token, subscription);
  if (!synced) return {ok: false, error: 'sync_failed'} as const;

  return {ok: true} as const;
}

export async function unsubscribeWebPush(apiBase: string, token: string) {
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) return {ok: true} as const;

  const payload = serializePushSubscription(subscription);
  if (payload && token) {
    try {
      await fetch(`${apiBase}/push/unsubscribe`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
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
