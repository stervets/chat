import {Prisma} from '@prisma/client';
import {db} from '../db.js';
import {pruneExpiredUploads} from '../common/uploads.js';

const MAX_MESSAGES_PER_ROOM = 5000;
const UPLOADS_TTL_DAYS = 30;
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

type CleanupLogger = {
  info: (obj: Record<string, unknown>, msg: string) => void;
  error: (obj: Record<string, unknown>, msg: string) => void;
};

export async function runMessagesCleanup(logger: CleanupLogger = console as CleanupLogger) {
  try {
    const limitResult = await db.$executeRaw(
      Prisma.sql`
        delete from messages
        where id in (
          select id from (
            select
              m.id,
              row_number() over (partition by m.room_id order by m.created_at desc, m.id desc) as rn
            from messages m
            left join rooms r on r.id = m.room_id
            where r.pinned_message_id is null or r.pinned_message_id <> m.id
          ) ranked
          where rn > ${MAX_MESSAGES_PER_ROOM}
        )
      `
    );
    const uploadsCutoffMs = Date.now() - UPLOADS_TTL_DAYS * 24 * 60 * 60 * 1000;
    const uploadsDeleted = pruneExpiredUploads(uploadsCutoffMs);
    const deletedByLimit = Number(limitResult || 0);
    logger.info({
      deletedByLimit,
      deleted: deletedByLimit,
      uploadsDeleted,
      uploadsTtlDays: UPLOADS_TTL_DAYS,
      maxMessagesPerRoom: MAX_MESSAGES_PER_ROOM,
    }, 'Messages cleanup completed');
  } catch (err) {
    logger.error({err}, 'Messages cleanup failed');
  }
}

export function registerCleanupJob(logger: CleanupLogger = console as CleanupLogger) {
  const timer = setInterval(() => {
    void runMessagesCleanup(logger);
  }, CLEANUP_INTERVAL_MS);
  timer.unref();
}
