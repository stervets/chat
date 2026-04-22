type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{outcome: 'accepted' | 'dismissed'; platform: string}>;
};

let listenersAttached = false;
let deferredPrompt: BeforeInstallPromptEvent | null = null;

function detectIosDevice(userAgent: string, platform: string, maxTouchPoints: number) {
  if (/iPad|iPhone|iPod/i.test(userAgent)) return true;
  return platform === 'MacIntel' && maxTouchPoints > 1;
}

function detectSafariBrowser(userAgent: string) {
  if (!/safari/i.test(userAgent)) return false;
  return !/crios|fxios|edgios|opr\/|opios|yaapp_ios|yabrowser|duckduckgo|fbav|fban|instagram/i.test(userAgent);
}

function detectMobileDevice(userAgent: string, maxTouchPoints: number) {
  if (/android|iphone|ipad|ipod|mobile/i.test(userAgent)) return true;
  return maxTouchPoints > 1;
}

function detectTelegramInAppBrowser(userAgent: string) {
  return /telegram/i.test(userAgent);
}

function detectInstalledMode() {
  if (typeof window === 'undefined') return false;

  const standaloneDisplayMode = window.matchMedia('(display-mode: standalone)').matches;
  const iosStandaloneMode = Boolean((navigator as any)?.standalone);
  return standaloneDisplayMode || iosStandaloneMode;
}

export function usePwaInstall() {
  const isInstallAvailable = useState<boolean>('pwa:is-install-available', () => false);
  const isInstalled = useState<boolean>('pwa:is-installed', () => false);
  const isIos = useState<boolean>('pwa:is-ios', () => false);
  const isSafari = useState<boolean>('pwa:is-safari', () => false);
  const isMobile = useState<boolean>('pwa:is-mobile', () => false);
  const isTelegramInApp = useState<boolean>('pwa:is-telegram-in-app', () => false);
  const showIosInstructions = useState<boolean>('pwa:show-ios-instructions', () => false);
  const showInstallFallback = useState<boolean>('pwa:show-install-fallback', () => false);

  const syncInstalledState = () => {
    isInstalled.value = detectInstalledMode();
    if (isInstalled.value) {
      isInstallAvailable.value = false;
      showIosInstructions.value = false;
      showInstallFallback.value = false;
    }
  };

  const syncPlatformState = () => {
    if (typeof navigator === 'undefined') return;

    const userAgent = navigator.userAgent || '';
    const platform = navigator.platform || '';
    const maxTouchPoints = Number((navigator as any)?.maxTouchPoints || 0);

    isIos.value = detectIosDevice(userAgent, platform, maxTouchPoints);
    isSafari.value = detectSafariBrowser(userAgent);
    isMobile.value = detectMobileDevice(userAgent, maxTouchPoints);
    isTelegramInApp.value = detectTelegramInAppBrowser(userAgent);
  };

  const onBeforeInstallPrompt = (event: Event) => {
    event.preventDefault();
    deferredPrompt = event as BeforeInstallPromptEvent;

    syncInstalledState();
    isInstallAvailable.value = !isInstalled.value;
  };

  const onAppInstalled = () => {
    deferredPrompt = null;
    isInstalled.value = true;
    isInstallAvailable.value = false;
    showIosInstructions.value = false;
    showInstallFallback.value = false;
  };

  if (import.meta.client && !listenersAttached) {
    listenersAttached = true;

    syncPlatformState();
    syncInstalledState();

    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);
    window.addEventListener('appinstalled', onAppInstalled);
    window.addEventListener('pageshow', syncInstalledState);
  }

  const installApp = async () => {
    syncInstalledState();
    if (isInstalled.value) return false;

    if (deferredPrompt) {
      const promptEvent = deferredPrompt;
      deferredPrompt = null;
      isInstallAvailable.value = false;

      try {
        await promptEvent.prompt();
        await promptEvent.userChoice;
      } catch {
        // no-op
      }

      syncInstalledState();
      return true;
    }

    if (isIos.value && isSafari.value) {
      showIosInstructions.value = true;
      return false;
    }

    if (isMobile.value) {
      showInstallFallback.value = true;
    }

    return false;
  };

  return {
    isInstallAvailable,
    isInstalled,
    isIos,
    isSafari,
    isMobile,
    isTelegramInApp,
    showIosInstructions,
    showInstallFallback,
    installApp,
  };
}
