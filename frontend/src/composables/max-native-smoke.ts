import {registerPlugin} from '@capacitor/core';
import {isNativeAndroidApp} from '@/composables/native-runtime';

type MaxNativeSmokeRunOptions = {
  wsUrl?: string;
  origin?: string;
  userAgent?: string;
  token: string;
  deviceId?: string;
  chatId?: number;
};

type MaxNativeSmokeLog = {
  ts?: number;
  event?: string;
  data?: Record<string, unknown>;
};

type MaxNativeSmokeResult = {
  ok: boolean;
  error?: string | null;
  closeCode?: number;
  closeReason?: string;
  logs?: MaxNativeSmokeLog[];
};

type MaxNativeSmokePlugin = {
  run(options: MaxNativeSmokeRunOptions): Promise<MaxNativeSmokeResult>;
};

export const MaxNativeSmokeTest = registerPlugin<MaxNativeSmokePlugin>('MaxNativeSmokeTest');

export async function runMaxNativeSmokeFromRuntime() {
  if (!isNativeAndroidApp()) {
    return {
      ok: false,
      error: 'not_android_runtime',
    } as const;
  }

  const config = useRuntimeConfig();
  const reserve = ((config.public as any)?.maxReserve || {}) as Record<string, any>;

  const token = String(reserve.token || '').trim();
  if (!token) {
    return {
      ok: false,
      error: 'max_reserve_token_empty',
    } as const;
  }

  return MaxNativeSmokeTest.run({
    wsUrl: String(reserve.wsUrl || 'wss://ws-api.oneme.ru/websocket').trim(),
    origin: 'https://web.max.ru',
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36',
    token,
    deviceId: String(reserve.deviceId || '4af2d638-3d77-47dd-abe6-9812f5147a90').trim(),
    chatId: Number(reserve.chatId || 0),
  });
}
