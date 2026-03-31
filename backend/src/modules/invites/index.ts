import type {FastifyInstance} from 'fastify';
import * as crypto from 'node:crypto';
import {API_PREFIX} from '../../common/const.js';
import {db} from '../../db.js';
import {createSession, hashPassword} from '../../common/auth.js';

export async function registerInvitesModule(app: FastifyInstance) {
  app.get(`${API_PREFIX}/invites`, async (request, reply) => {
    if (!request.user) {
      reply.code(401);
      return {ok: false, error: 'unauthorized'};
    }

    const result = db.prepare(
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
       where i.created_by = ?
       order by i.created_at desc`
    ).all(request.user.id);

    return result.map((row: any) => ({
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

    const code = crypto.randomBytes(8).toString('hex');
    const insert = db.prepare(
      'insert into invites (code, created_by) values (?, ?)'
    ).run(code, request.user.id);
    const created = db.prepare(
      'select id, code, created_at as "createdAt" from invites where id = ?'
    ).get(Number(insert.lastInsertRowid));

    return created;
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

    const usersCountRow = db.prepare('select count(*) as c from users').get() as {c: number};
    const usersCount = usersCountRow?.c || 0;

    if (usersCount === 0) {
      const passwordHash = await hashPassword(password);
      const userInsert = db.prepare(
        'insert into users (nickname, password_hash) values (?, ?)'
      ).run(nickname, passwordHash);
      const userId = Number(userInsert.lastInsertRowid);

      await createSession(userId, request, reply);
      return {ok: true};
    }

    const passwordHash = await hashPassword(password);

    try {
      db.exec('begin immediate');
      const invite = db.prepare(
        'select * from invites where code = ?'
      ).get(code) as any;

      if (!invite) {
        db.exec('rollback');
        reply.code(404);
        return {ok: false, error: 'invite_not_found'};
      }

      const isExpired = invite.expires_at && new Date(invite.expires_at) < new Date();
      const isUsedUp = invite.used_at;

      if (isExpired || isUsedUp) {
        db.exec('rollback');
        reply.code(400);
        return {ok: false, error: 'invite_invalid'};
      }

      const existingUser = db.prepare(
        'select id from users where nickname = ?'
      ).get(nickname);

      if (existingUser) {
        db.exec('rollback');
        reply.code(409);
        return {ok: false, error: 'nickname_taken'};
      }

      const userInsert = db.prepare(
        'insert into users (nickname, password_hash) values (?, ?)'
      ).run(nickname, passwordHash);
      const userId = Number(userInsert.lastInsertRowid);
      const usedAt = new Date().toISOString();

      db.prepare(
        'update invites set used_by = ?, used_at = ? where id = ?'
      ).run(userId, usedAt, invite.id);

      db.exec('commit');

      await createSession(userId, request, reply);
      return {ok: true};
    } catch (err) {
      try {
        db.exec('rollback');
      } catch {
        // ignore rollback errors
      }
      throw err;
    }
  });
}
