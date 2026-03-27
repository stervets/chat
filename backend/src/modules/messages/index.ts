import type {FastifyInstance} from 'fastify';
import {API_PREFIX} from '../../common/const.js';

export async function registerMessagesModule(app: FastifyInstance) {
  app.get(`${API_PREFIX}/messages/:dialogId`, async () => {
    return {ok: false, error: 'not_implemented'};
  });

  app.post(`${API_PREFIX}/messages`, async () => {
    return {ok: false, error: 'not_implemented'};
  });
}
