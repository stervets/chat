import {randomBytes, randomUUID} from 'node:crypto';
import argon2 from 'argon2';
import type {FastifyReply, FastifyRequest} from 'fastify';
import {db} from '../db.js';
import {SESSION_COOKIE_NAME, SESSION_TTL_DAYS} from './const.js';

export async function hashPassword(password: string) {
  return argon2.hash(password);
}

export async function verifyPassword(hash: string, password: string) {
  return argon2.verify(hash, password);
}

export async function createSession(userId: number, request: FastifyRequest, reply: FastifyReply) {
  const sessionId = randomUUID();
  const token = randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
  const expiresAtIso = expiresAt.toISOString();
  const ip = request.ip;
  const userAgent = request.headers['user-agent'] || null;

  db.prepare(
    'insert into sessions (id, user_id, token, expires_at, ip, user_agent) values (?, ?, ?, ?, ?, ?)'
  ).run(sessionId, userId, token, expiresAtIso, ip, userAgent);

  reply.setCookie(SESSION_COOKIE_NAME, token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: false,
    expires: expiresAt,
  });

  return token;
}
