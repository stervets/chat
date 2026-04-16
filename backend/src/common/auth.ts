import {randomBytes, randomUUID} from 'node:crypto';
import argon2 from 'argon2';
import {db} from '../db.js';
import {SESSION_TTL_DAYS} from './const.js';

export type ResolvedSession = {
  user: {
    id: number;
    nickname: string;
  };
  token: string;
  expiresAt: string;
};

export async function hashPassword(password: string) {
  return argon2.hash(password);
}

export async function verifyPassword(hash: string, password: string) {
  return argon2.verify(hash, password);
}

export function createSession(userId: number, meta?: {ip?: string | null; userAgent?: string | null}) {
  const sessionId = randomUUID();
  const token = randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const ip = meta?.ip || null;
  const userAgent = meta?.userAgent || null;

  db.prepare(
    'insert into sessions (id, user_id, token, expires_at, ip, user_agent) values (?, ?, ?, ?, ?, ?)'
  ).run(sessionId, userId, token, expiresAt, ip, userAgent);

  return {token, expiresAt};
}

export function resolveSession(token: string): ResolvedSession | null {
  const nowIso = new Date().toISOString();
  const row = db.prepare(
    `select
       s.token as token,
       s.expires_at as "expiresAt",
       u.id as userId,
       u.nickname as nickname
     from sessions s
     join users u on u.id = s.user_id
     where s.token = ? and s.expires_at > ?
     limit 1`
  ).get(token, nowIso) as {
    token: string;
    expiresAt: string;
    userId: number;
    nickname: string;
  } | undefined;

  if (!row) return null;

  return {
    token: row.token,
    expiresAt: row.expiresAt,
    user: {
      id: row.userId,
      nickname: row.nickname,
    },
  };
}

export function revokeSession(token: string) {
  return db.prepare('delete from sessions where token = ?').run(token);
}
