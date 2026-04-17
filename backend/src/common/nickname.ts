export const NICKNAME_RE = /^[a-z0-9_-]{3,32}$/;

export function normalizeNickname(valueRaw: unknown) {
  return String(valueRaw ?? '').trim().toLowerCase();
}

export function isValidNickname(valueRaw: unknown) {
  const nickname = String(valueRaw ?? '');
  return NICKNAME_RE.test(nickname);
}

