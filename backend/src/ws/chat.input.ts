export function positiveInt(value: unknown) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function positiveIntList(value: unknown) {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(
    value
      .map((item) => positiveInt(item))
      .filter((item): item is number => !!item),
  ));
}

export function textValue(value: unknown, fallback = '') {
  const text = String(value ?? '').trim();
  return text || fallback;
}

export function boolValue(value: unknown, fallback = false) {
  if (value === undefined || value === null) return fallback;
  return value === true;
}

export function stringChoice<T extends string>(value: unknown, allowed: readonly T[], fallback: T) {
  const text = String(value ?? '').trim().toLowerCase();
  return allowed.includes(text as T) ? text as T : fallback;
}
