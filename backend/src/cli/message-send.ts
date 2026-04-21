import {randomBytes} from 'node:crypto';
import {WebSocket, type RawData} from 'ws';
import {createSession, revokeSession} from '../common/auth.js';
import {db, closeDb} from '../db.js';
import {normalizeNickname} from '../common/nickname.js';
import {config} from '../config.js';
import {BACKEND_PEER_ID, FRONTEND_PEER_ID, RESULT_COMMAND} from '../ws/protocol.js';

type RpcResult = {
  ok?: boolean;
  error?: string;
  [key: string]: unknown;
};

function getArg(name: string) {
  const direct = process.argv.find((arg) => arg.startsWith(`--${name}=`));
  if (direct) return direct.split('=').slice(1).join('=');

  const index = process.argv.indexOf(`--${name}`);
  if (index >= 0 && process.argv[index + 1]) return process.argv[index + 1];

  return '';
}

function getBoolArg(name: string) {
  const direct = process.argv.find((arg) => arg.startsWith(`--${name}=`));
  if (direct) {
    const value = direct.split('=').slice(1).join('=').trim().toLowerCase();
    if (!value) return true;
    if (['1', 'true', 'yes', 'y', 'on'].includes(value)) return true;
    if (['0', 'false', 'no', 'n', 'off'].includes(value)) return false;
    return true;
  }

  return process.argv.includes(`--${name}`);
}

function usage() {
  process.stderr.write('Usage: yarn run message:send -- --from <nickname> --chat group --text "..." [--silent] [--ws-url ws://127.0.0.1:8816/ws]\n');
}

function formatError(error: unknown) {
  if (error instanceof Error && error.message) return error.message;
  return String(error || 'unknown_error');
}

function resolveDefaultWsUrl() {
  const rawHost = String(config.host || '').trim();
  const host = !rawHost || rawHost === '0.0.0.0' || rawHost === '::' ? '127.0.0.1' : rawHost;
  return `ws://${host}:${config.port}${config.wsPath}`;
}

async function connectWs(url: string) {
  return new Promise<WebSocket>((resolve, reject) => {
    const ws = new WebSocket(url);

    const onOpen = () => {
      cleanup();
      resolve(ws);
    };

    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };

    const onTimeout = () => {
      cleanup();
      try {
        ws.close();
      } catch {
        // ignore
      }
      reject(new Error(`WS connect timeout: ${url}`));
    };

    const cleanup = () => {
      clearTimeout(timer);
      ws.off('open', onOpen);
      ws.off('error', onError);
    };

    const timer = setTimeout(onTimeout, 7000);
    ws.on('open', onOpen);
    ws.on('error', onError);
  });
}

async function wsCall(ws: WebSocket, com: string, args: any[]): Promise<RpcResult> {
  return new Promise((resolve, reject) => {
    const requestId = randomBytes(8).toString('hex');

    const onMessage = (raw: RawData) => {
      let parsed: any = null;
      try {
        parsed = JSON.parse(String(raw));
      } catch {
        return;
      }

      if (!Array.isArray(parsed) || parsed[0] !== RESULT_COMMAND || parsed[4] !== requestId) {
        return;
      }

      cleanup();
      const payload = Array.isArray(parsed[1]) ? parsed[1][0] : null;
      resolve((payload || {}) as RpcResult);
    };

    const onClose = () => {
      cleanup();
      reject(new Error(`WS closed while waiting for response: ${com}`));
    };

    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };

    const onTimeout = () => {
      cleanup();
      reject(new Error(`WS call timeout: ${com}`));
    };

    const cleanup = () => {
      clearTimeout(timer);
      ws.off('message', onMessage);
      ws.off('close', onClose);
      ws.off('error', onError);
    };

    const timer = setTimeout(onTimeout, 10000);
    ws.on('message', onMessage);
    ws.on('close', onClose);
    ws.on('error', onError);

    ws.send(JSON.stringify([
      com,
      args,
      FRONTEND_PEER_ID,
      BACKEND_PEER_ID,
      requestId,
    ]));
  });
}

async function run() {
  const from = normalizeNickname(getArg('from'));
  const chat = String(getArg('chat') || '').trim().toLowerCase();
  const text = String(getArg('text') || '');
  const silent = getBoolArg('silent');
  const wsUrl = String(getArg('ws-url') || '').trim() || resolveDefaultWsUrl();

  if (!from || !chat || !text) {
    usage();
    process.exit(1);
  }

  if (chat !== 'general' && chat !== 'group') {
    process.stderr.write(`Unsupported chat: ${chat}. Only --chat group is supported.\n`);
    process.exit(1);
  }

  const user = await db.user.findUnique({
    where: {nickname: from},
    select: {
      id: true,
      nickname: true,
    },
  });

  if (!user) {
    process.stderr.write(`User not found: ${from}\n`);
    process.exit(1);
  }

  const room = await db.room.findFirst({
    where: {kind: 'group'},
    select: {
      id: true,
    },
  });

  if (!room) {
    process.stderr.write('Group chat not found.\n');
    process.exit(1);
  }

  process.stdout.write(`user found: ${user.nickname} (id=${user.id})\n`);
  process.stdout.write(`chat found: group (id=${room.id})\n`);
  process.stdout.write(`ws target: ${wsUrl}\n`);

  let token = '';
  let ws: WebSocket | null = null;

  try {
    const session = await createSession(user.id, {
      ip: '127.0.0.1',
      userAgent: 'cli/message-send',
    });
    token = session.token;

    ws = await connectWs(wsUrl);

    const authResult = await wsCall(ws, 'auth:session', [token]);
    if (!authResult?.ok) {
      const error = String(authResult?.error || 'unauthorized');
      process.stderr.write(`Auth failed: ${error}\n`);
      process.exit(1);
    }

    const sendArgs = silent
      ? [room.id, text, {silent: true}]
      : [room.id, text];

    const sendResult = await wsCall(ws, 'chat:send', sendArgs);
    if (!sendResult?.ok) {
      const error = String(sendResult?.error || 'send_failed');
      process.stderr.write(`Failed to create message: ${error}\n`);
      process.exit(1);
    }

    const message = sendResult.message as {id?: number} | undefined;
    process.stdout.write(`message created: ${String(message?.id || 'unknown')}\n`);
    process.stdout.write(silent ? 'push: skipped (--silent)\n' : 'push: normal\n');
    process.stdout.write('ok\n');
  } finally {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.close();
    }
    if (token) {
      await revokeSession(token);
    }
  }
}

run()
  .catch((error) => {
    process.stderr.write(`${formatError(error)}\n`);
    process.exitCode = 1;
  })
  .finally(() => {
    void closeDb();
  });
