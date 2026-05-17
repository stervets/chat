import {isNativeRuntime} from '@/composables/native-runtime';

const PRODUCTION_API_ORIGIN = 'https://marx.core5.ru';
const LOCAL_BACKEND_PORT = '8816';

const normalizeWindowHost = (host: string) => (host === '0.0.0.0' ? '127.0.0.1' : host);
const isLoopbackHost = (host: string) => {
  const normalized = normalizeWindowHost(String(host || '').trim().toLowerCase());
  return normalized === 'localhost' || normalized === '127.0.0.1';
};

const isPrivateIpv4Host = (host: string) => {
  const normalized = normalizeWindowHost(String(host || '').trim().toLowerCase());
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(normalized)) return false;
  if (normalized.startsWith('10.')) return true;
  if (normalized.startsWith('192.168.')) return true;
  if (normalized.startsWith('172.')) {
    const secondOctet = Number(normalized.split('.')[1]);
    return Number.isFinite(secondOctet) && secondOctet >= 16 && secondOctet <= 31;
  }
  return false;
};

const isLocalLikeWebHost = (host: string) => isLoopbackHost(host) || isPrivateIpv4Host(host);

const getWebBackendOrigin = () => {
  if (typeof window === 'undefined') return '';
  const host = normalizeWindowHost(window.location.hostname);
  const protocol = window.location.protocol;
  if (isLocalLikeWebHost(host)) {
    return `${protocol}//${host}:${LOCAL_BACKEND_PORT}`;
  }
  return `${protocol}//${window.location.host}`;
};

const getConfiguredApiOrigin = () => {
  try {
    const config = useRuntimeConfig();
    const raw = String(config.public.apiUrl || '').trim();
    if (!raw) return '';
    const parsed = new URL(raw);
    return parsed.origin;
  } catch {
    return '';
  }
};

export const getApiBase = () => {
  if (process.client) {
    if (isNativeRuntime()) {
      return getConfiguredApiOrigin() || PRODUCTION_API_ORIGIN;
    }
    return getWebBackendOrigin();
  }

  const config = useRuntimeConfig();
  const raw = config.public.apiUrl || '';
  if (!raw) return '';

  try {
    const apiUrl = new URL(raw);
    return apiUrl.origin;
  } catch {
    return raw;
  }
};

export const getWsUrlCandidates = () => {
  const config = useRuntimeConfig();
  const wsPath = config.public.wsPath || '/ws';
  const rawWsUrl = (config.public as any).wsUrl || '';
  const values: string[] = [];
  const nativeRuntime = process.client && isNativeRuntime();

  const pushUrl = (value: string) => {
    if (!value) return;
    if (!values.includes(value)) {
      values.push(value);
    }
  };

  if (rawWsUrl && nativeRuntime) {
    try {
      const parsed = new URL(rawWsUrl);
      if (parsed.hostname === '0.0.0.0') {
        parsed.hostname = process.client ? normalizeWindowHost(window.location.hostname) : '127.0.0.1';
      }
      pushUrl(parsed.toString());
    } catch {
      if (process.client) {
        try {
          const parsed = new URL(rawWsUrl, window.location.origin);
          pushUrl(parsed.toString());
        } catch {
          // ignore invalid wsUrl
        }
      }
    }
  }

  const apiBase = getApiBase();
  if (apiBase) {
    try {
      const wsUrl = new URL(apiBase);
      wsUrl.protocol = wsUrl.protocol === 'https:' ? 'wss:' : 'ws:';
      wsUrl.pathname = wsPath.startsWith('/') ? wsPath : `/${wsPath}`;
      wsUrl.search = '';
      wsUrl.hash = '';
      pushUrl(wsUrl.toString());
    } catch {
      // ignore invalid apiBase
    }
  }

  if (process.client) {
    const windowHost = normalizeWindowHost(window.location.hostname);
    const shouldUseWebFallback = nativeRuntime || !isLocalLikeWebHost(windowHost);
    if (!shouldUseWebFallback) {
      return values;
    }

    try {
      const fallback = new URL(wsPath, window.location.origin);
      fallback.protocol = fallback.protocol === 'https:' ? 'wss:' : 'ws:';
      fallback.search = '';
      fallback.hash = '';
      if (fallback.hostname === '0.0.0.0') {
        fallback.hostname = normalizeWindowHost(window.location.hostname);
      }
      pushUrl(fallback.toString());
    } catch {
      // ignore
    }
  }

  return values;
};
