export const HANDLED_MESSAGE_IDS_STORAGE_PREFIX = 'chat:handled-message-notification-ids:v1';
export const HANDLED_MESSAGE_IDS_LIMIT = 8000;
export const SOUND_ENABLED_STORAGE_KEY = 'chat:notifications-sound-enabled:v1';
export const SOUND_OVERLAY_SKIP_ONCE_KEY = 'chat:sound-overlay-skip-once:v1';
export const BROWSER_NOTIFICATIONS_ENABLED_STORAGE_KEY = 'chat:browser-notifications-enabled:v1';
export const WEB_PUSH_ENABLED_STORAGE_KEY = 'chat:web-push-enabled:v1';
export const VIBRATION_ENABLED_STORAGE_KEY = 'chat:vibration-enabled:v1';
export const PINNED_PANEL_HEIGHT_RATIO_STORAGE_KEY = 'chat:pinned-panel-height-ratio:v1';
export const PINNED_COLLAPSED_STORAGE_PREFIX = 'chat:pinned-collapsed:v1';

function hasWindow() {
  return typeof window !== 'undefined';
}

export function getHandledMessageIdsStorageKey(userIdRaw: unknown) {
  const userId = Number(userIdRaw || 0);
  if (!Number.isFinite(userId) || userId <= 0) return '';
  return `${HANDLED_MESSAGE_IDS_STORAGE_PREFIX}:${userId}`;
}

export function parseHandledMessageIds(raw: unknown, limit = HANDLED_MESSAGE_IDS_LIMIT) {
  if (!Array.isArray(raw)) return {};

  const ids: number[] = [];
  const seen = new Set<number>();
  for (const value of raw) {
    const id = Number.parseInt(String(value ?? ''), 10);
    if (!Number.isFinite(id) || id <= 0 || seen.has(id)) continue;
    ids.push(id);
    seen.add(id);
    if (ids.length >= limit) break;
  }

  const next: Record<number, true> = {};
  ids.forEach((id) => {
    next[id] = true;
  });
  return next;
}

export function loadHandledMessageIds(storageKey: string, limit = HANDLED_MESSAGE_IDS_LIMIT) {
  if (!hasWindow() || !storageKey) return {};

  const raw = window.localStorage.getItem(storageKey);
  if (!raw) return {};

  try {
    const parsed = JSON.parse(raw);
    return parseHandledMessageIds(parsed, limit);
  } catch {
    return {};
  }
}

export function normalizeHandledMessageIdsMap(
  mapRaw: Record<number, true> | Record<string, unknown>,
  limit = HANDLED_MESSAGE_IDS_LIMIT,
) {
  const ids = Object.keys(mapRaw || {})
    .map((key) => Number.parseInt(key, 10))
    .filter((id) => Number.isFinite(id) && id > 0)
    .sort((left, right) => right - left)
    .slice(0, limit);

  const normalizedMap: Record<number, true> = {};
  ids.forEach((id) => {
    normalizedMap[id] = true;
  });

  return {
    ids,
    normalizedMap,
  };
}

export function persistHandledMessageIds(storageKey: string, ids: number[]) {
  if (!hasWindow() || !storageKey) return;

  try {
    window.localStorage.setItem(storageKey, JSON.stringify(ids));
  } catch {}
}

export function loadBooleanSetting(storageKey: string, fallbackValue = true) {
  if (!hasWindow()) return fallbackValue;
  const raw = window.localStorage.getItem(storageKey);
  if (raw === null) return fallbackValue;
  return raw !== '0';
}

export function persistBooleanSetting(storageKey: string, value: boolean) {
  if (!hasWindow()) return;
  window.localStorage.setItem(storageKey, value ? '1' : '0');
}

export function getPinnedCollapsedStorageKey(roomIdRaw: unknown) {
  const roomId = Number(roomIdRaw || 0);
  if (!Number.isFinite(roomId) || roomId <= 0) return '';
  return `${PINNED_COLLAPSED_STORAGE_PREFIX}:${roomId}`;
}

export function loadNumberSetting(storageKey: string, fallbackValue: number, min: number, max: number) {
  if (!hasWindow()) return fallbackValue;
  const raw = String(window.localStorage.getItem(storageKey) || '').trim();
  if (!raw) return fallbackValue;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallbackValue;
  return Math.min(max, Math.max(min, parsed));
}

export function persistNumberSetting(storageKey: string, valueRaw: unknown, min: number, max: number) {
  if (!hasWindow()) return;
  const value = Number(valueRaw);
  if (!Number.isFinite(value)) return;
  const clamped = Math.min(max, Math.max(min, value));
  window.localStorage.setItem(storageKey, String(clamped));
}

export function consumeSessionFlagOnce(storageKey: string, expectedValue = '1') {
  if (!hasWindow()) return false;
  const raw = window.sessionStorage.getItem(storageKey);
  if (raw !== expectedValue) return false;
  window.sessionStorage.removeItem(storageKey);
  return true;
}
