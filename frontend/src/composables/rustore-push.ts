import {registerPlugin} from '@capacitor/core';
import {isNativeAndroidApp} from '@/composables/native-runtime';

const RUSTORE_PUSH_TOKEN_STORAGE_KEY = 'marx_rustore_push_token_v1';

export type RuStorePushPayload = {
  provider?: string;
  platform?: string;
  type?: string;
  title?: string;
  body?: string;
  roomId?: string;
  messageId?: string;
  callId?: string;
  channelId?: string;
};

type RuStorePushRegisterOptions = {
  projectId: string;
};

type RuStorePushTokenResult = {
  token: string;
};

type RuStorePushLaunchResult = {
  notification: RuStorePushPayload | null;
};

type RuStorePushPlugin = {
  register(options: RuStorePushRegisterOptions): Promise<RuStorePushTokenResult>;
  getToken(): Promise<RuStorePushTokenResult>;
  getLaunchNotification(): Promise<RuStorePushLaunchResult>;
  addListener(eventName: 'token', listenerFunc: (result: RuStorePushTokenResult) => void): Promise<{remove: () => Promise<void>}>;
  addListener(eventName: 'pushReceived', listenerFunc: (result: {notification: RuStorePushPayload}) => void): Promise<{remove: () => Promise<void>}>;
  addListener(eventName: 'pushActionPerformed', listenerFunc: (result: {notification: RuStorePushPayload}) => void): Promise<{remove: () => Promise<void>}>;
};

export const RuStorePush = registerPlugin<RuStorePushPlugin>('RuStorePush');

export function isRuStorePushEnabledRuntime() {
  return isNativeAndroidApp();
}

export function getStoredRuStorePushToken() {
  if (typeof window === 'undefined') return '';
  return localStorage.getItem(RUSTORE_PUSH_TOKEN_STORAGE_KEY) || '';
}

export function setStoredRuStorePushToken(tokenRaw: string) {
  if (typeof window === 'undefined') return;
  const token = String(tokenRaw || '').trim();
  if (!token) {
    localStorage.removeItem(RUSTORE_PUSH_TOKEN_STORAGE_KEY);
    return;
  }
  localStorage.setItem(RUSTORE_PUSH_TOKEN_STORAGE_KEY, token);
}

export function buildRuStorePushRoute(payloadRaw: RuStorePushPayload) {
  const payload = payloadRaw && typeof payloadRaw === 'object' ? payloadRaw : {};
  const query: Record<string, string> = {};
  const roomId = String(payload.roomId || '').trim();
  const messageId = String(payload.messageId || '').trim();
  const callId = String(payload.callId || '').trim();

  if (roomId) query.room = roomId;
  if (messageId) query.focusMessage = messageId;
  if (callId) query.callId = callId;

  return {
    path: '/chat',
    query,
  };
}
