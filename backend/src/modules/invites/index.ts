import type {FastifyInstance} from 'fastify';
import {randomBytes} from 'node:crypto';
import {API_PREFIX} from '../../common/const.js';
import {pool} from '../../db.js';
import {createSession, hashPassword} from '../../common/auth.js';

export async function registerInvitesModule(app: FastifyInstance) {
  app.get(`${API_PREFIX}/invites`, async (request, reply) => {
    if (!request.user) {
      reply.code(401);
      return {ok: false, error: 'unauthorized'};
    }

    const result = await pool.query(
      `select
         i.id,
         i.code,
         i.created_at as "createdAt",
         i.used_at as "usedAt",
         i.used_by as "usedById",
         u.nickname as "usedByNickname",
         (i.used_at is not null) as "isUsed"
       from invites i
       left join users u on u.id = i.used_by
       where i.created_by = $1
       order by i.created_at desc`,
      [request.user.id]
    );

    return result.rows.map((row) => ({
      id: row.id,
      code: row.code,
      createdAt: row.createdAt,
      usedAt: row.usedAt,
      usedBy: row.usedById ? {id: row.usedById, nickname: row.usedByNickname} : null,
      isUsed: row.isUsed
    }));
  });

  app.post(`${API_PREFIX}/invites/create`, async (request, reply) => {
    if (!request.user) {
      reply.code(401);
      return {ok: false, error: 'unauthorized'};
    }

    const code = randomBytes(8).toString('hex');
    const created = await pool.query(
      'insert into invites (code, created_by) values ($1, $2) returning id, code, created_at as "createdAt"',
      [code, request.user.id]
    );

    return created.rows[0];
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
      const isUsedUp = row.used_at;

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
        'update invites set used_by = $1, used_at = now() where id = $2',
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
