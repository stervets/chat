import {App} from '@capacitor/app';
import {Network} from '@capacitor/network';
import {forceWsReconnect} from '@/composables/ws-rpc';
import {isNativeAndroidApp} from '@/composables/native-runtime';

export default defineNuxtPlugin(() => {
  if (!isNativeAndroidApp()) return;
  if (typeof window === 'undefined') return;

  const MIN_RECONNECT_GAP_MS = 5000;
  let lastReconnectAt = 0;

  const reconnect = (reason: string) => {
    if (reason === 'offline') return;
    const now = Date.now();
    if (now - lastReconnectAt < MIN_RECONNECT_GAP_MS) return;
    lastReconnectAt = now;
    void forceWsReconnect(reason);
  };

  void App.addListener('resume', () => {
    reconnect('resume');
  });

  void App.addListener('appStateChange', ({isActive}) => {
    if (!isActive) return;
    reconnect('foreground');
  });

  void Network.addListener('networkStatusChange', (status) => {
    if (!status.connected) return;
    reconnect('network');
  });

  window.addEventListener('online', () => {
    reconnect('online');
  });

  window.addEventListener('offline', () => {
    reconnect('offline');
  });
});
