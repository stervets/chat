import {randomBytes} from 'node:crypto';
import {mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {config} from '../config.js';

const baseDir = resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..');
const uploadsDir = resolve(baseDir, config.uploads.path);
const UPLOAD_NAME_RE = /^[a-zA-Z0-9._-]+$/;

const MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/avif': '.avif',
  'image/bmp': '.bmp',
  'video/mp4': '.mp4',
  'video/webm': '.webm',
  'video/quicktime': '.mov',
  'video/x-m4v': '.m4v',
  'video/ogg': '.ogv',
};

const EXT_TO_MIME: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.m4v': 'video/x-m4v',
  '.ogv': 'video/ogg',
};

export const UPLOADS_PUBLIC_PREFIX = '/uploads';

export function ensureUploadsDir() {
  mkdirSync(uploadsDir, {recursive: true});
}

export function extensionByMime(mimeRaw: string) {
  const mime = String(mimeRaw || '').toLowerCase();
  return MIME_TO_EXT[mime] || '.bin';
}

export function mimeByFileName(fileNameRaw: string) {
  const fileName = String(fileNameRaw || '').toLowerCase();
  const dotIndex = fileName.lastIndexOf('.');
  if (dotIndex < 0) return 'application/octet-stream';
  const ext = fileName.slice(dotIndex);
  return EXT_TO_MIME[ext] || 'application/octet-stream';
}

export function createUploadFileName(mime: string) {
  const ext = extensionByMime(mime);
  return `${Date.now()}-${randomBytes(10).toString('hex')}${ext}`;
}

export function sanitizeUploadName(nameRaw: unknown) {
  const name = String(nameRaw || '').trim();
  if (!name || !UPLOAD_NAME_RE.test(name)) return null;
  return name;
}

export function saveUploadBuffer(fileName: string, buffer: Buffer) {
  ensureUploadsDir();
  const fullPath = resolve(uploadsDir, fileName);
  writeFileSync(fullPath, buffer);
  return `${UPLOADS_PUBLIC_PREFIX}/${fileName}`;
}

export function readUploadFile(fileNameRaw: unknown) {
  const fileName = sanitizeUploadName(fileNameRaw);
  if (!fileName) return null;

  const fullPath = resolve(uploadsDir, fileName);
  try {
    const content = readFileSync(fullPath);
    return {
      fileName,
      content,
      mime: mimeByFileName(fileName),
    };
  } catch {
    return null;
  }
}

export function deleteUploadFile(fileNameRaw: unknown) {
  const fileName = sanitizeUploadName(fileNameRaw);
  if (!fileName) return false;

  const fullPath = resolve(uploadsDir, fileName);
  try {
    unlinkSync(fullPath);
    return true;
  } catch {
    return false;
  }
}

export function pruneExpiredUploads(cutoffMs: number) {
  ensureUploadsDir();
  let deleted = 0;

  for (const name of readdirSync(uploadsDir)) {
    const safeName = sanitizeUploadName(name);
    if (!safeName) continue;

    const fullPath = resolve(uploadsDir, safeName);
    try {
      const stat = statSync(fullPath);
      if (!stat.isFile()) continue;
      if (stat.mtimeMs >= cutoffMs) continue;
      unlinkSync(fullPath);
      deleted += 1;
    } catch {
      // ignore single-file errors
    }
  }

  return deleted;
}
