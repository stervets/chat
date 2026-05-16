import {chromium} from 'playwright';

const MAX_WS_URL = process.env.MAX_WS_URL || 'wss://ws-api.oneme.ru/websocket';
const MAX_TOKEN = String(process.env.MAX_RESERVE_TOKEN || '').trim();
const MAX_DEVICE_ID = String(process.env.MAX_DEVICE_ID || '4af2d638-3d77-47dd-abe6-9812f5147a90').trim();
const TARGET_URL = process.env.CHECK_URL || 'http://127.0.0.1:8815/login';
const CHAT_ID = Number(process.env.MAX_CHAT_ID || 0);

if (!MAX_TOKEN) {
  console.error('MAX_RESERVE_TOKEN is required');
  process.exit(1);
}

const run = async () => {
  const browser = await chromium.launch({headless: true});
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(TARGET_URL, {waitUntil: 'domcontentloaded', timeout: 30000});

    const result = await page.evaluate(async ({wsUrl, token, deviceId, chatId}) => {
      const logs = [];
      const add = (type, payload = {}) => logs.push({ts: Date.now(), type, ...payload});

      add('origin', {origin: window.location.origin});

      const ws = new WebSocket(wsUrl);
      let stage = 0;
      let done = false;

      const finish = (status) => {
        if (done) return status;
        done = true;
        return status;
      };

      const nextCid = () => -(Date.now() * 1000 + Math.floor(Math.random() * 1000));

      return await new Promise((resolve) => {
        const hardTimeout = window.setTimeout(() => {
          add('timeout', {message: '30s timeout'});
          try { ws.close(1000, 'timeout'); } catch {}
          resolve(finish({ok: false, logs}));
        }, 30000);

        const sendOpcode6 = () => {
          const payload = {
            ver: 11,
            cmd: 0,
            seq: 0,
            opcode: 6,
            payload: {
              userAgent: {
                deviceType: 'WEB',
                locale: 'ru',
                deviceLocale: 'ru',
                osVersion: 'Linux',
                deviceName: 'Chrome',
                headerUserAgent: navigator.userAgent,
                appVersion: '26.5.8',
                screen: `${Math.max(window.screen.width || 0, 1)}x${Math.max(window.screen.height || 0, 1)} ${Number(window.devicePixelRatio || 1).toFixed(1)}x`,
                timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Moscow',
              },
              deviceId,
            },
          };
          add('send', {opcode: 6, seq: 0, payload});
          ws.send(JSON.stringify(payload));
        };

        const sendOpcode19 = () => {
          const payload = {
            ver: 11,
            cmd: 0,
            seq: 1,
            opcode: 19,
            payload: {
              token,
              chatsCount: 40,
              interactive: true,
              chatsSync: 0,
              contactsSync: 0,
              presenceSync: -1,
              draftsSync: 0,
            },
          };
          add('send', {opcode: 19, seq: 1, payload: {...payload, payload: {...payload.payload, token: '[hidden]'}}});
          ws.send(JSON.stringify(payload));
        };

        const sendOpcode64 = () => {
          const payload = {
            ver: 11,
            cmd: 0,
            seq: 2,
            opcode: 64,
            payload: {
              chatId,
              message: {
                text: `browser smoke ${new Date().toISOString()}`,
                cid: nextCid(),
                elements: [],
                attaches: [],
              },
              notify: true,
            },
          };
          add('send', {opcode: 64, seq: 2, payload});
          ws.send(JSON.stringify(payload));
        };

        ws.addEventListener('open', () => {
          add('open', {message: 'MAX ws open'});
          stage = 1;
          sendOpcode6();
        });

        ws.addEventListener('message', (event) => {
          const raw = String(event.data || '');
          let parsed = null;
          try { parsed = JSON.parse(raw); } catch {}

          add('message', {
            raw,
            opcode: parsed?.opcode,
            seq: parsed?.seq,
            cmd: parsed?.cmd,
            payload: parsed?.payload,
          });

          if (!parsed) return;

          if (stage === 1 && parsed.opcode === 6 && (parsed.cmd === 1 || parsed.cmd === 3)) {
            stage = 2;
            sendOpcode19();
            return;
          }

          if (stage === 2 && parsed.opcode === 19 && (parsed.cmd === 1 || parsed.cmd === 3)) {
            stage = 3;
            sendOpcode64();
            return;
          }

          if (stage === 3 && parsed.opcode === 64 && (parsed.cmd === 1 || parsed.cmd === 3)) {
            stage = 4;
            window.setTimeout(() => {
              try { ws.close(1000, 'done'); } catch {}
            }, 500);
          }
        });

        ws.addEventListener('error', () => {
          add('error', {message: 'WebSocket error event'});
        });

        ws.addEventListener('close', (event) => {
          add('close', {code: event.code, reason: event.reason || ''});
          window.clearTimeout(hardTimeout);
          resolve(finish({ok: true, logs}));
        });
      });
    }, {
      wsUrl: MAX_WS_URL,
      token: MAX_TOKEN,
      deviceId: MAX_DEVICE_ID,
      chatId: CHAT_ID,
    });

    console.log(JSON.stringify(result, null, 2));
  } finally {
    await browser.close();
  }
};

run().catch((error) => {
  console.error(error?.stack || String(error));
  process.exit(1);
});
