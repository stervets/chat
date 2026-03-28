import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import {config} from './config.js';
import {checkDb, closeDb, pool} from './db.js';
import {createWsServer} from './ws/server.js';
import {registerCleanupJob} from './jobs/cleanup.js';
import {registerAuthModule} from './modules/auth/index.js';
import {registerInvitesModule} from './modules/invites/index.js';
import {registerUsersModule} from './modules/users/index.js';
import {registerDialogsModule} from './modules/dialogs/index.js';
import {SESSION_COOKIE_NAME} from './common/const.js';

async function bootstrap() {
  const app = Fastify({logger: true});

  await app.register(cors, {
    origin: config.corsOrigins,
    credentials: true,
  });

  await app.register(cookie);

  app.addHook('onRequest', async (request) => {
    const token = request.cookies?.[SESSION_COOKIE_NAME];
    if (!token) return;
    try {
      const result = await pool.query(
        `select u.id, u.nickname
         from sessions s
         join users u on u.id = s.user_id
         where s.token = $1 and s.expires_at > now()
         limit 1`,
        [token]
      );

      if (result.rowCount) {
        request.user = result.rows[0];
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
    await checkDb();
    app.log.info('PostgreSQL connection OK');
  } catch (err) {
    app.log.error({err}, 'PostgreSQL connection failed');
    await closeDb();
    process.exit(1);
    return;
  }

  await app.listen({
    port: config.port,
    host: config.host,
  });

  createWsServer(app.server);
  registerCleanupJob(pool, app.log);

  app.log.info(`HTTP server listening on ${config.host}:${config.port}`);
}

bootstrap();
