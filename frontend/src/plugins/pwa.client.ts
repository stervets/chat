import {usePwaInstall} from '@/composables/use-pwa-install';

export default defineNuxtPlugin(() => {
  if (typeof window === 'undefined') return;
  usePwaInstall();
  if (!('serviceWorker' in navigator)) return;

  const registerServiceWorker = () => {
    void navigator.serviceWorker.register('/sw.js')
      .then((registration) => {
        console.info('[web-push] service worker register success', {
          scope: registration.scope,
          scriptUrl: '/sw.js',
        });
      })
      .catch((error: any) => {
        console.warn('[web-push] service worker register failed', {
          scriptUrl: '/sw.js',
          error: String(error?.message || error || 'unknown_error').trim() || 'unknown_error',
        });
      });
  };

  if (document.readyState === 'complete') {
    registerServiceWorker();
    return;
  }

  window.addEventListener('load', registerServiceWorker, {once: true});
});
