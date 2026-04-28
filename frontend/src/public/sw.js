const STATIC_CACHE = 'marx-static-v10';
const STATIC_ASSETS = [
  '/manifest.webmanifest',
  '/favicon.png',
  '/favicon-alert.png',
  '/marx_logo.png',
  '/pwa-192.png',
  '/pwa-512.png',
  '/apple-touch-icon.png',
  '/chat-bg.webp',
];

const STATIC_ASSET_SET = new Set(STATIC_ASSETS);

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(STATIC_CACHE);
    await cache.addAll(STATIC_ASSETS);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter((key) => key !== STATIC_CACHE)
        .map((key) => caches.delete(key))
    );
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const {request} = event;
  if (request.method !== 'GET') return;
  if (request.headers.has('range')) return;

  const requestUrl = new URL(request.url);
  if (requestUrl.origin !== self.location.origin) return;
  if (!STATIC_ASSET_SET.has(requestUrl.pathname)) return;

  event.respondWith((async () => {
    const cache = await caches.open(STATIC_CACHE);
    const cached = await cache.match(request, {ignoreSearch: true});
    if (cached) return cached;

    const response = await fetch(request);
    if (response.ok) {
      await cache.put(request, response.clone());
    }
    return response;
  })());
});

async function parsePushPayload(event) {
  if (!event.data) return null;

  try {
    return event.data.json();
  } catch {
    try {
      const textRaw = event.data.text();
      const text = String(await Promise.resolve(textRaw || '')).trim();
      if (!text) return null;
      return {
        body: text,
      };
    } catch {
      return null;
    }
  }
}

function buildChatUrlFromPush(payload, action) {
  const payloadUrl = String(payload.url || '/chat').trim() || '/chat';
  const roomId = Number(payload.roomId || payload.dialogId || 0);
  const messageId = Number(payload.messageId || 0);
  const callId = String(payload.callId || '').trim();
  const url = new URL(payloadUrl, self.location.origin);

  if (Number.isFinite(roomId) && roomId > 0) {
    url.pathname = '/chat';
    url.searchParams.set('room', String(roomId));
  }
  if (Number.isFinite(messageId) && messageId > 0) {
    url.searchParams.set('focusMessage', String(messageId));
  }
  if (callId) {
    url.pathname = '/chat';
    url.searchParams.set('callId', callId);
    if (action === 'answer' || action === 'reject') {
      url.searchParams.set('callAction', action);
    }
  }
  return url.toString();
}

self.addEventListener('push', (event) => {
  event.waitUntil((async () => {
    const payload = await parsePushPayload(event) || {};
    const type = String(payload.type || '').trim();
    const isIncomingCall = type === 'incoming_call';
    const title = String(payload.title || (isIncomingCall ? 'MARX · Входящий звонок' : 'MARX'));
    const body = String(payload.body || '').trim() || (isIncomingCall ? 'Входящий звонок' : 'Новое сообщение');
    const roomId = Number(payload.roomId || payload.dialogId || 0) || null;
    const messageId = Number(payload.messageId || 0) || null;
    const callId = String(payload.callId || '').trim() || null;
    const url = buildChatUrlFromPush(payload, 'open');

    await self.registration.showNotification(title, {
      body,
      icon: String(payload.icon || '/favicon-alert.png'),
      badge: String(payload.badge || '/pwa-192.png'),
      tag: String(payload.tag || (isIncomingCall && callId ? `marx-call-${callId}` : `marx-push-${roomId || 'chat'}`)),
      renotify: isIncomingCall,
      requireInteraction: !!payload.requireInteraction || isIncomingCall,
      actions: isIncomingCall
        ? [
          {action: 'answer', title: 'Ответить'},
          {action: 'reject', title: 'Отклонить'},
        ]
        : [],
      data: {
        type,
        url,
        roomId,
        messageId,
        callId,
      },
    });
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const notificationData = event.notification?.data || {};
  const targetUrl = buildChatUrlFromPush(notificationData, event.action || 'open');

  event.waitUntil((async () => {
    const clientsList = await self.clients.matchAll({
      type: 'window',
      includeUncontrolled: true,
    });

    for (const client of clientsList) {
      const currentUrl = new URL(client.url);
      if (currentUrl.origin !== self.location.origin) continue;

      await client.focus();
      if ('navigate' in client) {
        await client.navigate(targetUrl);
      }
      return;
    }

    if (self.clients.openWindow) {
      await self.clients.openWindow(targetUrl);
    }
  })());
});
