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
        return `${window.location.protocol}//${window.location.hostname}${port}`;
      }
      return apiUrl.origin;
    }
    return apiUrl.origin;
  } catch {
    return raw;
  }
};

export const getWsUrl = () => {
  const config = useRuntimeConfig();
  const wsPath = config.public.wsPath || '/ws';
  const apiBase = getApiBase();

  if (!apiBase) {
    return '';
  }

  const wsUrl = new URL(apiBase);
  wsUrl.protocol = wsUrl.protocol === 'https:' ? 'wss:' : 'ws:';
  wsUrl.pathname = wsPath.startsWith('/') ? wsPath : `/${wsPath}`;
  wsUrl.search = '';
  wsUrl.hash = '';
  return wsUrl.toString();
};
