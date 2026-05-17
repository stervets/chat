import {App} from '@capacitor/app';
import {Network} from '@capacitor/network';
import {forceWsReconnect, wsConnectionState} from '@/composables/ws-rpc';
import {isNativeAndroidApp} from '@/composables/native-runtime';

export default defineNuxtPlugin(() => {
  if (!isNativeAndroidApp()) return;
  if (typeof window === 'undefined') return;

  const MIN_RECONNECT_GAP_MS = 12000;
  const STARTUP_RECONNECT_GUARD_MS = 5000;
  const startedAt = Date.now();
  let lastReconnectAt = 0;
  let lastNetworkConnected: boolean | null = null;
  let windowOnline = navigator.onLine;

  const reconnect = (reason: string) => {
    if (reason === 'offline') return;
    if ((reason === 'resume' || reason === 'foreground') && Date.now() - startedAt < STARTUP_RECONNECT_GUARD_MS) {
      return;
    }
    if (wsConnectionState.value !== 'disconnected') return;
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

  void Network.getStatus().then((status) => {
    lastNetworkConnected = !!status.connected;
  }).catch(() => {});

  void Network.addListener('networkStatusChange', (status) => {
    const connected = !!status.connected;
    if (lastNetworkConnected === null) {
      lastNetworkConnected = connected;
      return;
    }

    const wasConnected = lastNetworkConnected;
    lastNetworkConnected = connected;
    if (!wasConnected && connected) {
      reconnect('network');
    }
  });

  window.addEventListener('online', () => {
    if (!windowOnline) {
      windowOnline = true;
      reconnect('online');
    }
  });

  window.addEventListener('offline', () => {
    windowOnline = false;
  });
});
