import {on} from '@/composables/event-bus';
import {getSessionToken, restoreSession} from '@/composables/ws-rpc';

function stringValue(value: unknown) {
  return String(value || '').trim();
}

function toPositiveNumber(value: unknown) {
  const number = Number(value || 0);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function isCallExcludedRoute(pathRaw: unknown) {
  const path = stringValue(pathRaw);
  if (!path) return true;
  if (path === '/login') return true;
  if (path === '/invites') return true;
  if (path.startsWith('/invite/')) return true;
  return false;
}

function normalizeIncomingCallPayload(raw: any) {
  if (!raw || typeof raw !== 'object') return null;
  const callId = stringValue(raw.callId);
  const roomId = toPositiveNumber(raw.roomId);
  const status = stringValue(raw.status);
  if (!callId || !roomId) return null;
  if (status !== 'ringing') return null;
  return {callId, roomId};
}

export default defineNuxtPlugin(() => {
  if (typeof window === 'undefined') return;

  const router = useRouter();
  let restoreSessionPromise: Promise<void> | null = null;
  let callSessionReady = false;
  let lastToken = '';

  const ensureCallEventsSession = async () => {
    const currentPath = String(router.currentRoute.value.path || '');
    if (isCallExcludedRoute(currentPath)) return;

    const token = stringValue(getSessionToken());
    if (!token) return;
    if (lastToken !== token) {
      lastToken = token;
      callSessionReady = false;
    }
    if (callSessionReady) return;
    if (restoreSessionPromise) return restoreSessionPromise;

    restoreSessionPromise = (async () => {
      try {
        const session = await restoreSession();
        callSessionReady = !!(session as any)?.ok;
      } catch {
        callSessionReady = false;
      } finally {
        restoreSessionPromise = null;
      }
    })();

    return restoreSessionPromise;
  };

  const openIncomingCallRoute = (callId: string, roomId: number) => {
    const currentRoute = router.currentRoute.value;
    const currentPath = String(currentRoute?.path || '');
    if (isCallExcludedRoute(currentPath)) return;

    const currentCallId = stringValue(Array.isArray(currentRoute?.query?.callId)
      ? currentRoute?.query?.callId[0]
      : currentRoute?.query?.callId);
    const currentRoomId = toPositiveNumber(Array.isArray(currentRoute?.query?.room)
      ? currentRoute?.query?.room[0]
      : currentRoute?.query?.room);
    if (currentPath === '/chat' && currentCallId === callId && currentRoomId === roomId) {
      return;
    }

    void router.push({
      path: '/chat',
      query: {
        room: String(roomId),
        callId,
      },
    });
  };

  on('call:incoming', (payload: any) => {
    const call = normalizeIncomingCallPayload(payload);
    if (!call) return;
    openIncomingCallRoute(call.callId, call.roomId);
  });

  router.afterEach((to) => {
    if (isCallExcludedRoute(to.path)) return;
    void ensureCallEventsSession();
  });

  void ensureCallEventsSession();
});
