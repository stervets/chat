import {createServer} from 'node:http';
import {WebSocketServer} from 'ws';
import {config} from '../config.js';
import type {RunnerRequest} from '../scriptable/runner-protocol.js';
import {handleRunnerRequest} from './registry.js';

function safeParseRequest(raw: string): RunnerRequest | null {
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    if (typeof parsed.id !== 'string' || !parsed.id) return null;
    if (parsed.type !== 'room_event' && parsed.type !== 'entity_action') return null;
    if (!parsed.payload || typeof parsed.payload !== 'object') return null;
    return parsed as RunnerRequest;
  } catch {
    return null;
  }
}

function run() {
  const server = createServer();
  const wsServer = new WebSocketServer({
    server,
    path: config.scriptRunner.path,
  });

  wsServer.on('connection', (socket) => {
    socket.on('message', (raw) => {
      const request = safeParseRequest(String(raw));
      if (!request) {
        socket.send(JSON.stringify({
          id: '',
          ok: false,
          error: 'invalid_runner_request',
        }));
        return;
      }

      const response = handleRunnerRequest(request);
      socket.send(JSON.stringify(response));
    });
  });

  server.listen(config.scriptRunner.port, config.scriptRunner.host, () => {
    process.stdout.write(
      `[script-runner] listening on ws://${config.scriptRunner.host}:${config.scriptRunner.port}${config.scriptRunner.path}\n`,
    );
  });

  const close = () => {
    wsServer.close(() => {
      server.close(() => {
        process.exit(0);
      });
    });
  };

  process.on('SIGINT', close);
  process.on('SIGTERM', close);
}

run();
