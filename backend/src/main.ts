import 'reflect-metadata';
import {NestFactory} from '@nestjs/core';
import {Logger} from '@nestjs/common';
import {WsAdapter} from '@nestjs/platform-ws';
import {AppModule} from './app.module.js';
import {config} from './config.js';
import {checkDb, closeDb, db} from './db.js';
import {registerCleanupJob, runMessagesCleanup} from './jobs/cleanup.js';
import {BACKEND_PEER_ID} from './ws/protocol.js';

async function bootstrap() {
  const logger = new Logger(BACKEND_PEER_ID);
  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  app.useWebSocketAdapter(new WsAdapter(app));

  try {
    checkDb();
    logger.log('SQLite connection OK');
  } catch (err) {
    logger.error('SQLite connection failed');
    await closeDb();
    process.exit(1);
    return;
  }

  await runMessagesCleanup(db, {
    info: (obj, msg) => logger.log(`${msg} ${JSON.stringify(obj)}`),
    error: (obj, msg) => logger.error(`${msg} ${JSON.stringify(obj)}`),
  });

  registerCleanupJob(db, {
    info: (obj, msg) => logger.log(`${msg} ${JSON.stringify(obj)}`),
    error: (obj, msg) => logger.error(`${msg} ${JSON.stringify(obj)}`),
  });

  app.enableShutdownHooks();
  await app.listen(config.port, config.host);
  logger.log(`Nest WS server listening on ${config.host}:${config.port}${config.wsPath}`);

  const close = async () => {
    await app.close();
    await closeDb();
  };
  process.on('SIGINT', () => void close());
  process.on('SIGTERM', () => void close());
}

bootstrap();
