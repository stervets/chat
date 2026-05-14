import {App} from '@capacitor/app';
import {Network} from '@capacitor/network';
import {forceWsReconnect} from '@/composables/ws-rpc';
import {isNativeAndroidApp} from '@/composables/native-runtime';

export default defineNuxtPlugin(() => {
  if (!isNativeAndroidApp()) return;
  if (typeof window === 'undefined') return;

  const reconnect = (reason: string) => {
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
