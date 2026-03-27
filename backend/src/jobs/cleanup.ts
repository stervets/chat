import type {Pool} from 'pg';
import {config} from '../config.js';

const ONE_HOUR_MS = 60 * 60 * 1000;

export function registerCleanupJob(pool: Pool) {
  const ttlDays = config.messagesTtlDays;
  const run = async () => {
    // TODO: удалить сообщения старше TTL
    // delete from messages where expires_at < now()
    // ttlDays используется как источник правды
    return pool;
  };

  setInterval(run, ONE_HOUR_MS);
}
