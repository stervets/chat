import type {FastifyInstance} from 'fastify';
import {API_PREFIX} from '../../common/const.js';
import {pool} from '../../db.js';
import {
  getDialogById,
  getOrCreateGeneralDialog,
  getOrCreatePrivateDialog,
  userCanAccessDialog,
} from '../../common/dialogs.js';

export async function registerDialogsModule(app: FastifyInstance) {
  app.get(`${API_PREFIX}/dialogs/general`, async (request, reply) => {
    if (!request.user) {
      reply.code(401);
      return {ok: false, error: 'unauthorized'};
    }

    const dialog = await getOrCreateGeneralDialog();
    return {
      dialogId: dialog.id,
      type: 'general',
      title: 'Общий чат'
    };
  });

  app.post(`${API_PREFIX}/dialogs/private/:userId`, async (request, reply) => {
    if (!request.user) {
      reply.code(401);
      return {ok: false, error: 'unauthorized'};
    }

    const userId = Number.parseInt((request.params as any).userId, 10);
    if (!Number.isFinite(userId)) {
      reply.code(400);
      return {ok: false, error: 'invalid_user'};
    }

    if (userId === request.user.id) {
      reply.code(400);
      return {ok: false, error: 'self_dialog'};
    }

    const targetResult = await pool.query(
      'select id, nickname from users where id = $1',
      [userId]
    );

    if (!targetResult.rowCount) {
      reply.code(404);
      return {ok: false, error: 'user_not_found'};
    }

    const dialog = await getOrCreatePrivateDialog(request.user.id, userId);

    return {
      dialogId: dialog.id,
      type: 'private',
      targetUser: targetResult.rows[0]
    };
  });

  app.get(`${API_PREFIX}/dialogs/:dialogId/messages`, async (request, reply) => {
    if (!request.user) {
      reply.code(401);
      return {ok: false, error: 'unauthorized'};
    }

    const dialogId = Number.parseInt((request.params as any).dialogId, 10);
    if (!Number.isFinite(dialogId)) {
      reply.code(400);
      return {ok: false, error: 'invalid_dialog'};
    }

    const dialog = await getDialogById(dialogId);
    if (!dialog) {
      reply.code(404);
      return {ok: false, error: 'dialog_not_found'};
    }

    if (!userCanAccessDialog(request.user.id, dialog)) {
      reply.code(403);
      return {ok: false, error: 'forbidden'};
    }

    const limitRaw = (request.query as any)?.limit;
    const limitParsed = Number.parseInt(limitRaw, 10);
    const limit = Number.isFinite(limitParsed) ? Math.min(Math.max(limitParsed, 1), 200) : 100;

    const result = await pool.query(
      `select * from (
         select
           m.id,
           m.dialog_id as "dialogId",
           m.sender_id as "authorId",
           u.nickname as "authorNickname",
           m.body,
           m.created_at as "createdAt"
         from messages m
         left join users u on u.id = m.sender_id
         where m.dialog_id = $1
         order by m.created_at desc
         limit $2
       ) t
       order by t."createdAt" asc`,
      [dialogId, limit]
    );

    return result.rows;
  });
}
