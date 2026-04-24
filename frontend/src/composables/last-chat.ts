const LAST_CHAT_PATH_STORAGE_KEY = 'chat:last-dialog-path:v1';

function hasWindow() {
  return typeof window !== 'undefined';
}

export function loadLastChatPath() {
  if (!hasWindow()) return '/chat';
  try {
    const value = String(window.localStorage.getItem(LAST_CHAT_PATH_STORAGE_KEY) || '').trim();
    if (!value.startsWith('/')) return '/chat';
    if (!value.startsWith('/chat') && !value.startsWith('/direct/')) return '/chat';
    return value;
  } catch {
    return '/chat';
  }
}

export function persistLastChatPath(pathRaw: unknown) {
  if (!hasWindow()) return;
  const value = String(pathRaw || '').trim();
  if (!value.startsWith('/')) return;
  if (!value.startsWith('/chat') && !value.startsWith('/direct/')) return;
  try {
    window.localStorage.setItem(LAST_CHAT_PATH_STORAGE_KEY, value);
  } catch {
    // no-op
  }
}
