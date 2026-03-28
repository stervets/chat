import type {FastifyInstance} from 'fastify';
import {API_PREFIX, SESSION_COOKIE_NAME} from '../../common/const.js';
import {db} from '../../db.js';
import {createSession, hashPassword, verifyPassword} from '../../common/auth.js';

export async function registerAuthModule(app: FastifyInstance) {
  app.post(`${API_PREFIX}/auth/login`, async (request, reply) => {
    const {nickname, password} = (request.body || {}) as {
      nickname?: string;
      password?: string;
    };

    if (!nickname || !password) {
      reply.code(400);
      return {ok: false, error: 'invalid_input'};
    }

    const user = db.prepare(
      'select id, nickname, password_hash from users where nickname = ?'
    ).get(nickname) as {id: number; nickname: string; password_hash: string} | undefined;

    if (!user) {
      reply.code(401);
      return {ok: false, error: 'invalid_credentials'};
    }

    const valid = await verifyPassword(user.password_hash, password);
    if (!valid) {
      reply.code(401);
      return {ok: false, error: 'invalid_credentials'};
    }

    await createSession(user.id, request, reply);
    return {ok: true};
  });

  app.post(`${API_PREFIX}/auth/change-password`, async (request, reply) => {
    if (!request.user) {
      reply.code(401);
      return {ok: false, error: 'unauthorized'};
    }

    const {oldPassword, newPassword} = (request.body || {}) as {
      oldPassword?: string;
      newPassword?: string;
    };

    if (!oldPassword || !newPassword) {
      reply.code(400);
      return {ok: false, error: 'invalid_input'};
    }

    const current = db.prepare(
      'select password_hash from users where id = ?'
    ).get(request.user.id) as {password_hash: string} | undefined;

    if (!current) {
      reply.code(404);
      return {ok: false, error: 'not_found'};
    }

    const valid = await verifyPassword(current.password_hash, oldPassword);
    if (!valid) {
      reply.code(403);
      return {ok: false, error: 'invalid_credentials'};
    }

    const hash = await hashPassword(newPassword);
    const updatedAt = new Date().toISOString();
    db.prepare(
      'update users set password_hash = ?, updated_at = ? where id = ?'
    ).run(hash, updatedAt, request.user.id);

    return {ok: true};
  });

  app.post(`${API_PREFIX}/auth/logout`, async (request, reply) => {
    if (!request.user) {
      reply.code(401);
      return {ok: false, error: 'unauthorized'};
    }

    const token = request.cookies?.[SESSION_COOKIE_NAME];
    if (token) {
      db.prepare('delete from sessions where token = ?').run(token);
      reply.clearCookie(SESSION_COOKIE_NAME, {path: '/'});
    }
    return {ok: true};
  });
}
