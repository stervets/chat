import {usePwaInstall} from '@/composables/use-pwa-install';

export default defineNuxtPlugin(() => {
  if (typeof window === 'undefined') return;
  usePwaInstall();
  if (!('serviceWorker' in navigator)) return;

  const registerServiceWorker = () => {
    void navigator.serviceWorker.register('/sw.js').catch(() => undefined);
  };

  if (document.readyState === 'complete') {
    registerServiceWorker();
    return;
  }

  window.addEventListener('load', registerServiceWorker, {once: true});
});
