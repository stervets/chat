import type {FastifyInstance} from 'fastify';
import {randomBytes} from 'node:crypto';
import {API_PREFIX} from '../../common/const.js';
import {pool} from '../../db.js';
import {createSession, hashPassword} from '../../common/auth.js';

export async function registerInvitesModule(app: FastifyInstance) {
  app.post(`${API_PREFIX}/invites/create`, async (request, reply) => {
    if (!request.user) {
      reply.code(401);
      return {ok: false, error: 'unauthorized'};
    }

    const code = randomBytes(8).toString('hex');
    await pool.query(
      'insert into invites (code, created_by) values ($1, $2)',
      [code, request.user.id]
    );

    return {ok: true, code};
  });

  app.post(`${API_PREFIX}/invites/redeem`, async (request, reply) => {
    const {code, nickname, password} = (request.body || {}) as {
      code?: string;
      nickname?: string;
      password?: string;
    };

    if (!code || !nickname || !password) {
      reply.code(400);
      return {ok: false, error: 'invalid_input'};
    }

    const client = await pool.connect();
    try {
      await client.query('begin');

      const invite = await client.query(
        'select * from invites where code = $1 for update',
        [code]
      );

      if (!invite.rowCount) {
        await client.query('rollback');
        reply.code(404);
        return {ok: false, error: 'invite_not_found'};
      }

      const row = invite.rows[0];
      const isExpired = row.expires_at && new Date(row.expires_at) < new Date();
      const isUsedUp = row.uses >= row.max_uses || row.used_at;

      if (isExpired || isUsedUp) {
        await client.query('rollback');
        reply.code(400);
        return {ok: false, error: 'invite_invalid'};
      }

      const existingUser = await client.query(
        'select id from users where nickname = $1',
        [nickname]
      );

      if (existingUser.rowCount) {
        await client.query('rollback');
        reply.code(409);
        return {ok: false, error: 'nickname_taken'};
      }

      const passwordHash = await hashPassword(password);
      const userResult = await client.query(
        'insert into users (nickname, password_hash) values ($1, $2) returning id',
        [nickname, passwordHash]
      );

      const userId = userResult.rows[0].id as number;

      await client.query(
        'update invites set used_by = $1, used_at = now(), uses = uses + 1 where id = $2',
        [userId, row.id]
      );

      await client.query('commit');

      await createSession(userId, request, reply);
      return {ok: true};
    } catch (err) {
      await client.query('rollback');
      throw err;
    } finally {
      client.release();
    }
  });
}
