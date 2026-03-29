import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import {config} from './config.js';
import {checkDb, closeDb, db} from './db.js';
import {createWsServer} from './ws/server.js';
import {registerCleanupJob, runMessagesCleanup} from './jobs/cleanup.js';
import {registerAuthModule} from './modules/auth/index.js';
import {registerInvitesModule} from './modules/invites/index.js';
import {registerUsersModule} from './modules/users/index.js';
import {registerDialogsModule} from './modules/dialogs/index.js';
import {SESSION_COOKIE_NAME} from './common/const.js';

async function bootstrap() {
  const app = Fastify({logger: true});

  const corsOrigin = Array.isArray(config.corsOrigins) && config.corsOrigins.includes('*')
    ? true
    : config.corsOrigins;

  await app.register(cors, {
    origin: corsOrigin,
    credentials: true,
  });

  await app.register(cookie);

  app.addHook('onRequest', async (request) => {
    const token = request.cookies?.[SESSION_COOKIE_NAME];
    if (!token) return;
    try {
      const nowIso = new Date().toISOString();
      const result = db.prepare(
        `select u.id, u.nickname
         from sessions s
         join users u on u.id = s.user_id
         where s.token = ? and s.expires_at > ?
         limit 1`,
      ).get(token, nowIso);

      if (result) {
        request.user = result as any;
      }
    } catch (err) {
      request.log.warn({err}, 'Failed to resolve session');
    }
  });

  app.get('/health', async () => ({
    ok: true,
    time: new Date().toISOString()
  }));

  await registerAuthModule(app);
  await registerInvitesModule(app);
  await registerUsersModule(app);
  await registerDialogsModule(app);

  app.addHook('onClose', async () => {
    await closeDb();
  });

  try {
    checkDb();
    app.log.info('SQLite connection OK');
  } catch (err) {
    app.log.error({err}, 'SQLite connection failed');
    await closeDb();
    process.exit(1);
    return;
  }

  await runMessagesCleanup(db, app.log);

  await app.listen({
    port: config.port,
    host: config.host,
  });

  createWsServer(app.server);
  registerCleanupJob(db, app.log);

  app.log.info(`HTTP server listening on ${config.host}:${config.port}`);
}

bootstrap();
