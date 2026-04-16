const normalizeWindowHost = (host: string) => (host === '0.0.0.0' ? '127.0.0.1' : host);

export const getApiBase = () => {
  const config = useRuntimeConfig();
  const raw = config.public.apiUrl || '';

  if (!raw) {
    return process.client ? window.location.origin : '';
  }

  try {
    const apiUrl = new URL(raw);
    if (process.client) {
      const isLocal = apiUrl.hostname === 'localhost' || apiUrl.hostname === '127.0.0.1';
      if (isLocal) {
        const port = apiUrl.port ? `:${apiUrl.port}` : '';
        const host = normalizeWindowHost(window.location.hostname);
        return `${window.location.protocol}//${host}${port}`;
      }
      return apiUrl.origin;
    }
    return apiUrl.origin;
  } catch {
    return raw;
  }
};

export const getWsUrl = () => {
  const candidates = getWsUrlCandidates();
  return candidates[0] || '';
};

export const getWsUrlCandidates = () => {
  const config = useRuntimeConfig();
  const wsPath = config.public.wsPath || '/ws';
  const rawWsUrl = (config.public as any).wsUrl || '';
  const values: string[] = [];

  const pushUrl = (value: string) => {
    if (!value) return;
    if (!values.includes(value)) {
      values.push(value);
    }
  };

  if (rawWsUrl) {
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
