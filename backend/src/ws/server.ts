import type {Server} from 'http';
import {WebSocketServer} from 'ws';
import {config} from '../config.js';
import {registerWsHandlers} from './handlers.js';
import {pool} from '../db.js';
import {SESSION_COOKIE_NAME} from '../common/const.js';

const parseCookies = (header?: string) => {
  const cookies: Record<string, string> = {};
  if (!header) return cookies;
  const parts = header.split(';');
  for (const part of parts) {
    const [key, ...rest] = part.trim().split('=');
    if (!key) continue;
    cookies[key] = decodeURIComponent(rest.join('='));
  }
  return cookies;
};

export function createWsServer(server: Server) {
  const wss = new WebSocketServer({
    server,
    path: config.wsPath,
  });

  const wsHandlers = registerWsHandlers();

  wss.on('connection', (socket, request) => {
    (async () => {
      const cookies = parseCookies(request.headers.cookie);
      const token = cookies[SESSION_COOKIE_NAME];
      if (!token) {
        socket.close(4401, 'unauthorized');
        return;
      }

      const result = await pool.query(
        `select u.id, u.nickname
         from sessions s
         join users u on u.id = s.user_id
         where s.token = $1 and s.expires_at > now()
         limit 1`,
        [token]
      );

      if (!result.rowCount) {
        socket.close(4401, 'unauthorized');
        return;
      }

      (socket as any).user = result.rows[0];

      socket.on('message', (data) => {
        wsHandlers.handleMessage(socket as any, data.toString());
      });

      socket.on('close', () => {
        wsHandlers.onClose(socket as any);
      });
    })().catch(() => {
      socket.close(1011, 'server_error');
    });
  });

  return wss;
}
