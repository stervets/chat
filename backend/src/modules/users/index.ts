import type {FastifyInstance} from 'fastify';
import {API_PREFIX} from '../../common/const.js';
import {pool} from '../../db.js';

export async function registerUsersModule(app: FastifyInstance) {
  app.get(`${API_PREFIX}/me`, async (request, reply) => {
    if (!request.user) {
      reply.code(401);
      return {ok: false, error: 'unauthorized'};
    }

    return {
      id: request.user.id,
      nickname: request.user.nickname,
    };
  });

  app.get(`${API_PREFIX}/users`, async (request, reply) => {
    if (!request.user) {
      reply.code(401);
      return {ok: false, error: 'unauthorized'};
    }

    const result = await pool.query(
      'select id, nickname from users where id <> $1 order by nickname asc',
      [request.user.id]
    );

    return result.rows;
  });
}
