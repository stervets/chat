import {config} from '../config.js';
import type {DatabaseSync} from 'node:sqlite';
import {pruneExpiredUploads} from '../common/uploads.js';

const MOSCOW_UTC_OFFSET_MS = 3 * 60 * 60 * 1000;
const MOSCOW_CLEANUP_HOUR = 3;
const MAX_MESSAGES_PER_DIALOG = 5000;

type CleanupLogger = {
  info: (obj: Record<string, unknown>, msg: string) => void;
  error: (obj: Record<string, unknown>, msg: string) => void;
};

export async function runMessagesCleanup(db: DatabaseSync, logger: CleanupLogger = console as CleanupLogger) {
  const ttlDays = Math.max(1, Math.floor(config.messagesTtlDays || 1));
  try {
    const cutoff = new Date(Date.now() - ttlDays * 24 * 60 * 60 * 1000).toISOString();
    const cutoffMs = Date.now() - ttlDays * 24 * 60 * 60 * 1000;
    const ttlResult = db.prepare(
      'delete from messages where created_at < ?'
    ).run(cutoff);
    const limitResult = db.prepare(
      `delete from messages
       where id in (
         select id from (
           select
             id,
             row_number() over (partition by dialog_id order by created_at desc, id desc) as rn
           from messages
         ) ranked
         where rn > ?
       )`
    ).run(MAX_MESSAGES_PER_DIALOG);
    const uploadsDeleted = pruneExpiredUploads(cutoffMs);
    const deletedByTtl = Number(ttlResult.changes);
    const deletedByLimit = Number(limitResult.changes);
    logger.info({
      deletedByTtl,
      deletedByLimit,
      deleted: deletedByTtl + deletedByLimit,
      uploadsDeleted,
      ttlDays,
      maxMessagesPerDialog: MAX_MESSAGES_PER_DIALOG,
    }, 'Messages cleanup completed');
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
