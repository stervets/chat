const LAST_CHAT_PATH_STORAGE_KEY = 'chat:last-dialog-path:v1';

function hasWindow() {
  return typeof window !== 'undefined';
}

function normalizeChatPath(pathRaw: unknown) {
  const value = String(pathRaw || '').trim();
  if (!value.startsWith('/')) return '/chat';
  if (!value.startsWith('/chat') && !value.startsWith('/direct/')) return '/chat';

  const hashIndex = value.indexOf('#');
  const withoutHash = hashIndex >= 0 ? value.slice(0, hashIndex) : value;
  const hashPart = hashIndex >= 0 ? value.slice(hashIndex) : '';

  const queryIndex = withoutHash.indexOf('?');
  const pathPartRaw = queryIndex >= 0 ? withoutHash.slice(0, queryIndex) : withoutHash;
  const queryPart = queryIndex >= 0 ? withoutHash.slice(queryIndex) : '';

  const normalizedPathPart = pathPartRaw === '/'
    ? '/'
    : (pathPartRaw.replace(/\/+$/, '') || '/');

  return `${normalizedPathPart}${queryPart}${hashPart}`;
}

export function loadLastChatPath() {
  if (!hasWindow()) return '/chat';
  try {
    const value = normalizeChatPath(window.localStorage.getItem(LAST_CHAT_PATH_STORAGE_KEY));
    if (!value.startsWith('/')) return '/chat';
    if (!value.startsWith('/chat') && !value.startsWith('/direct/')) return '/chat';
    return value;
  } catch {
    return '/chat';
  }
}

export function persistLastChatPath(pathRaw: unknown) {
  if (!hasWindow()) return;
  const value = normalizeChatPath(pathRaw);
  if (!value.startsWith('/')) return;
  if (!value.startsWith('/chat') && !value.startsWith('/direct/')) return;
  try {
    window.localStorage.setItem(LAST_CHAT_PATH_STORAGE_KEY, value);
  } catch {
    // no-op
  }
}
