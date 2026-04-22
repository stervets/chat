import 'reflect-metadata';
import {NestFactory} from '@nestjs/core';
import {Logger} from '@nestjs/common';
import {WsAdapter} from '@nestjs/platform-ws';
import {AppModule} from './app.module.js';
import {config} from './config.js';
import {checkDb, closeDb} from './db.js';
import {registerCleanupJob, runMessagesCleanup} from './jobs/cleanup.js';
import {BACKEND_PEER_ID} from './ws/protocol.js';

async function bootstrap() {
  const logger = new Logger(BACKEND_PEER_ID);
  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  let shutdownInProgress = false;

  const closeApp = async (signalRaw?: string) => {
    if (shutdownInProgress) return;
    shutdownInProgress = true;
    const signal = String(signalRaw || '').trim() || 'manual';

    try {
      logger.log(`Shutdown requested (${signal})`);
      await app.close();
      await closeDb();
      logger.log('Shutdown completed');
      process.exit(0);
    } catch (err) {
      logger.error(`Shutdown failed (${signal}) ${JSON.stringify({err})}`);
      process.exit(1);
    }
  };

  app.useWebSocketAdapter(new WsAdapter(app));
  app.enableCors({
    origin: config.corsOrigins.includes('*') ? true : config.corsOrigins,
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  try {
    await checkDb();
    logger.log('PostgreSQL connection OK');
  } catch (err) {
    logger.error('PostgreSQL connection failed');
    await closeApp('db-check-failed');
    return;
  }

  await runMessagesCleanup({
    info: (obj, msg) => logger.log(`${msg} ${JSON.stringify(obj)}`),
    error: (obj, msg) => logger.error(`${msg} ${JSON.stringify(obj)}`),
  });

  registerCleanupJob({
    info: (obj, msg) => logger.log(`${msg} ${JSON.stringify(obj)}`),
    error: (obj, msg) => logger.error(`${msg} ${JSON.stringify(obj)}`),
  });

  await app.listen(config.port, config.host);
  logger.log(`Nest WS server listening on ${config.host}:${config.port}${config.wsPath}`);

  process.once('SIGINT', () => void closeApp('SIGINT'));
  process.once('SIGTERM', () => void closeApp('SIGTERM'));
}

bootstrap();
