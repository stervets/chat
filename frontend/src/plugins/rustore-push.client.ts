import {LocalNotifications} from '@capacitor/local-notifications';
import {emit} from '@/composables/event-bus';
import {
  buildRuStorePushRoute,
  getStoredRuStorePushToken,
  isRuStorePushEnabledRuntime,
  RuStorePush,
  setStoredRuStorePushToken,
  type RuStorePushPayload,
} from '@/composables/rustore-push';
import {getSessionToken, wsRegisterNativePushToken} from '@/composables/ws-rpc';

function stringValue(value: unknown) {
  return String(value || '').trim();
}

function notificationIdFromPayload(payload: RuStorePushPayload) {
  const source = stringValue(payload.callId || payload.messageId || payload.roomId || `${Date.now()}`);
  let hash = 0;
  for (let index = 0; index < source.length; index += 1) {
    hash = ((hash << 5) - hash) + source.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash) || Date.now();
}

export default defineNuxtPlugin(() => {
  if (!isRuStorePushEnabledRuntime()) return;
  if (typeof window === 'undefined') return;

  const router = useRouter();
  const runtimeConfig = useRuntimeConfig();
  const projectId = stringValue((runtimeConfig.public as any)?.nativePush?.rustoreProjectId);

  if (!projectId) {
    console.warn('[rustore-push] nativePush.rustoreProjectId is empty');
    return;
  }

  let appIsVisible = document.visibilityState === 'visible';
  let registeringBackendToken = false;
  let lastBackendRegisteredToken = '';
  let lastBackendSessionToken = '';

  const openRouteFromPush = async (notification: RuStorePushPayload | null | undefined) => {
    const target = buildRuStorePushRoute(notification || {});
    await router.push(target);
  };

  const syncBackendToken = async (tokenRaw?: string) => {
    const token = stringValue(tokenRaw || getStoredRuStorePushToken());
    const sessionToken = stringValue(getSessionToken());
    if (!token || !sessionToken) return;
    if (registeringBackendToken) return;
    if (lastBackendRegisteredToken === token && lastBackendSessionToken === sessionToken) return;

    registeringBackendToken = true;
    try {
      const result = await wsRegisterNativePushToken(token, 'rustore', 'android');
      if ((result as any)?.ok) {
        lastBackendRegisteredToken = token;
        lastBackendSessionToken = sessionToken;
      }
    } finally {
      registeringBackendToken = false;
    }
  };

  const showForegroundNotification = async (notification: RuStorePushPayload) => {
    const isCall = stringValue(notification.type) === 'call' || !!stringValue(notification.callId);
    await LocalNotifications.schedule({
      notifications: [{
        id: notificationIdFromPayload(notification),
        title: stringValue(notification.title) || (isCall ? 'Входящий звонок' : 'MARX'),
        body: stringValue(notification.body) || (isCall ? 'Открой MARX' : 'Новое сообщение'),
        schedule: {at: new Date(Date.now() + 60)},
        channelId: stringValue(notification.channelId) || (isCall ? 'marx-calls' : 'marx-messages'),
        extra: notification,
      }],
    });
  };

  const handleForegroundPush = async (notification: RuStorePushPayload) => {
    if (!appIsVisible) return;
    if (stringValue(notification.type) === 'call' && stringValue(notification.callId) && stringValue(notification.roomId)) {
      emit('call:incoming', {
        callId: stringValue(notification.callId),
        roomId: Number(notification.roomId || 0),
        status: 'ringing',
      });
    }
    await showForegroundNotification(notification);
  };

  document.addEventListener('visibilitychange', () => {
    appIsVisible = document.visibilityState === 'visible';
  });

  router.afterEach(() => {
    void syncBackendToken();
  });

  void LocalNotifications.requestPermissions().catch(() => {});

  void RuStorePush.addListener('token', ({token}) => {
    const value = stringValue(token);
    if (!value) return;
    console.info('[rustore-push] token', value);
    setStoredRuStorePushToken(value);
    lastBackendRegisteredToken = '';
    lastBackendSessionToken = '';
    void syncBackendToken(value);
  });

  void RuStorePush.addListener('pushReceived', ({notification}) => {
    void handleForegroundPush(notification || {});
  });

  void RuStorePush.addListener('pushActionPerformed', ({notification}) => {
    void openRouteFromPush(notification || {});
  });

  void RuStorePush.addListener('pushError', ({code, message}) => {
    const errorCode = stringValue(code);
    const errorMessage = stringValue(message);
    console.warn(`[rustore-push] pushError code=${errorCode} message=${errorMessage}`);
    if (errorCode === 'HostAppBackgroundWorkPermissionNotGranted') {
      console.warn('[rustore-push] RuStore background work is disabled. Enable background activity/battery unrestricted for RuStore app.');
    }
  });

  void (async () => {
    const launch = await RuStorePush.getLaunchNotification().catch((error: unknown) => {
      console.error('[rustore-push] getLaunchNotification failed', error);
      return {notification: null};
    });
    if (launch?.notification) {
      await openRouteFromPush(launch.notification);
    }

    const result = await RuStorePush.register({projectId}).catch((error: unknown) => {
      console.error('[rustore-push] register failed', error);
      return {token: ''};
    });
    const token = stringValue(result?.token);
    if (token) {
      console.info('[rustore-push] token', token);
      setStoredRuStorePushToken(token);
      void syncBackendToken(token);
    }
  })();
});
