import {randomBytes} from 'node:crypto';
import argon2 from 'argon2';
import type {FastifyReply, FastifyRequest} from 'fastify';
import {pool} from '../db.js';
import {SESSION_COOKIE_NAME, SESSION_TTL_DAYS} from './const.js';

export async function hashPassword(password: string) {
  return argon2.hash(password);
}

export async function verifyPassword(hash: string, password: string) {
  return argon2.verify(hash, password);
}

export async function createSession(userId: number, request: FastifyRequest, reply: FastifyReply) {
  const token = randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
  const ip = request.ip;
  const userAgent = request.headers['user-agent'] || null;

  await pool.query(
    'insert into sessions (user_id, token, expires_at, ip, user_agent) values ($1, $2, $3, $4, $5)',
    [userId, token, expiresAt, ip, userAgent]
  );

  reply.setCookie(SESSION_COOKIE_NAME, token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: false,
    expires: expiresAt,
  });

  return token;
}
