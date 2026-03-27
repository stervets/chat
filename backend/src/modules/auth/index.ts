import type {FastifyInstance} from 'fastify';
import {API_PREFIX, SESSION_COOKIE_NAME} from '../../common/const.js';
import {pool} from '../../db.js';
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

    const result = await pool.query(
      'select id, nickname, password_hash from users where nickname = $1',
      [nickname]
    );

    if (!result.rowCount) {
      reply.code(401);
      return {ok: false, error: 'invalid_credentials'};
    }

    const user = result.rows[0];
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

    const current = await pool.query(
      'select password_hash from users where id = $1',
      [request.user.id]
    );

    if (!current.rowCount) {
      reply.code(404);
      return {ok: false, error: 'not_found'};
    }

    const valid = await verifyPassword(current.rows[0].password_hash, oldPassword);
    if (!valid) {
      reply.code(403);
      return {ok: false, error: 'invalid_credentials'};
    }

    const hash = await hashPassword(newPassword);
    await pool.query(
      'update users set password_hash = $1, updated_at = now() where id = $2',
      [hash, request.user.id]
    );

    return {ok: true};
  });

  app.post(`${API_PREFIX}/auth/logout`, async (request, reply) => {
    const token = request.cookies?.[SESSION_COOKIE_NAME];
    if (token) {
      await pool.query('delete from sessions where token = $1', [token]);
      reply.clearCookie(SESSION_COOKIE_NAME, {path: '/'});
    }
    return {ok: true};
  });
}
