import {config} from '../config.js';
import type {DatabaseSync} from 'node:sqlite';
import {pruneExpiredUploads} from '../common/uploads.js';

const ONE_HOUR_MS = 60 * 60 * 1000;

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

export function registerCleanupJob(db: DatabaseSync, logger: CleanupLogger = console as CleanupLogger) {
  const timer = setInterval(() => {
    void runMessagesCleanup(db, logger);
  }, ONE_HOUR_MS);
  timer.unref();
}
