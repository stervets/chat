import type {Pool} from 'pg';
import {config} from '../config.js';

const ONE_HOUR_MS = 60 * 60 * 1000;

type CleanupLogger = {
  info: (obj: Record<string, unknown>, msg: string) => void;
  error: (obj: Record<string, unknown>, msg: string) => void;
};

export async function runMessagesCleanup(pool: Pool, logger: CleanupLogger = console as CleanupLogger) {
  const ttlDays = Math.max(1, Math.floor(config.messagesTtlDays || 1));
  try {
    const result = await pool.query(
      "delete from messages where created_at < now() - ($1::int * interval '1 day')",
      [ttlDays]
    );
    logger.info({deleted: result.rowCount, ttlDays}, 'Messages cleanup completed');
  } catch (err) {
    logger.error({err, ttlDays}, 'Messages cleanup failed');
  }
}

export function registerCleanupJob(pool: Pool, logger: CleanupLogger = console as CleanupLogger) {
  const timer = setInterval(() => {
    void runMessagesCleanup(pool, logger);
  }, ONE_HOUR_MS);
  timer.unref();
}
