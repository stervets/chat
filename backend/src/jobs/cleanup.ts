import {config} from '../config.js';
import type {DatabaseSync} from 'node:sqlite';
import {pruneExpiredUploads} from '../common/uploads.js';

const MOSCOW_UTC_OFFSET_MS = 3 * 60 * 60 * 1000;
const MOSCOW_CLEANUP_HOUR = 3;

type CleanupLogger = {
  info: (obj: Record<string, unknown>, msg: string) => void;
  error: (obj: Record<string, unknown>, msg: string) => void;
};

export async function runMessagesCleanup(db: DatabaseSync, logger: CleanupLogger = console as CleanupLogger) {
  const ttlDays = Math.max(1, Math.floor(config.messagesTtlDays || 1));
  try {
    const cutoff = new Date(Date.now() - ttlDays * 24 * 60 * 60 * 1000).toISOString();
    const cutoffMs = Date.now() - ttlDays * 24 * 60 * 60 * 1000;
    const result = db.prepare(
      'delete from messages where created_at < ?'
    ).run(cutoff);
    const uploadsDeleted = pruneExpiredUploads(cutoffMs);
    logger.info({deleted: result.changes, uploadsDeleted, ttlDays}, 'Messages cleanup completed');
  } catch (err) {
    logger.error({err, ttlDays}, 'Messages cleanup failed');
  }
}

function msUntilNextMoscowCleanup(nowMs = Date.now()) {
  const nowMoscow = new Date(nowMs + MOSCOW_UTC_OFFSET_MS);
  const nextMoscow = new Date(nowMoscow);
  nextMoscow.setHours(MOSCOW_CLEANUP_HOUR, 0, 0, 0);
  if (nextMoscow.getTime() <= nowMoscow.getTime()) {
    nextMoscow.setDate(nextMoscow.getDate() + 1);
  }

  const nextUtcMs = nextMoscow.getTime() - MOSCOW_UTC_OFFSET_MS;
  return Math.max(1000, nextUtcMs - nowMs);
}

export function registerCleanupJob(db: DatabaseSync, logger: CleanupLogger = console as CleanupLogger) {
  const scheduleNext = () => {
    const delayMs = msUntilNextMoscowCleanup();
    const timer = setTimeout(() => {
      void runMessagesCleanup(db, logger).finally(() => {
        scheduleNext();
      });
    }, delayMs);
    timer.unref();
  };

  scheduleNext();
}
