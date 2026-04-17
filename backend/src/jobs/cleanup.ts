import {config} from '../config.js';
import {Prisma} from '@prisma/client';
import {db} from '../db.js';
import {pruneExpiredUploads} from '../common/uploads.js';

const MAX_MESSAGES_PER_DIALOG = 5000;
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

type CleanupLogger = {
  info: (obj: Record<string, unknown>, msg: string) => void;
  error: (obj: Record<string, unknown>, msg: string) => void;
};

export async function runMessagesCleanup(logger: CleanupLogger = console as CleanupLogger) {
  const ttlDays = Math.max(1, Math.floor(config.messagesTtlDays || 1));
  try {
    const cutoffDate = new Date(Date.now() - ttlDays * 24 * 60 * 60 * 1000);
    const cutoffMs = Date.now() - ttlDays * 24 * 60 * 60 * 1000;
    const ttlResult = await db.message.deleteMany({
      where: {
        createdAt: {lt: cutoffDate},
      },
    });
    const limitResult = await db.$executeRaw(
      Prisma.sql`
        delete from messages
        where id in (
          select id from (
            select
              id,
              row_number() over (partition by dialog_id order by created_at desc, id desc) as rn
            from messages
          ) ranked
          where rn > ${MAX_MESSAGES_PER_DIALOG}
        )
      `
    );
    const uploadsDeleted = pruneExpiredUploads(cutoffMs);
    const deletedByTtl = Number(ttlResult.count);
    const deletedByLimit = Number(limitResult || 0);
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

export function registerCleanupJob(logger: CleanupLogger = console as CleanupLogger) {
  const timer = setInterval(() => {
    void runMessagesCleanup(logger);
  }, CLEANUP_INTERVAL_MS);
  timer.unref();
}
