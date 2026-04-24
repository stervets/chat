import {getApiBase} from '@/composables/api';

const HTTP_RE = /^https?:\/\//i;
const DATA_RE = /^data:/i;
const BLOB_RE = /^blob:/i;

function trimTrailingSlash(raw: string) {
  return raw.replace(/\/+$/, '');
}

export function resolveMediaUrl(raw: unknown) {
  const value = String(raw || '').trim();
  if (!value) return '';
  if (HTTP_RE.test(value) || DATA_RE.test(value) || BLOB_RE.test(value)) {
    return value;
  }
  if (value.startsWith('/uploads/')) {
    const apiBase = trimTrailingSlash(String(getApiBase() || '').trim());
    if (!apiBase) return value;
    return `${apiBase}${value}`;
  }
  return value;
}
