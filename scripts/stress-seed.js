#!/usr/bin/env node

const {readFileSync} = require('node:fs');
const path = require('node:path');

function loadScriptsConfig() {
  const configPath = path.resolve(__dirname, 'config.json');
  const examplePath = path.resolve(__dirname, 'config.example.json');

  try {
    const raw = readFileSync(configPath, 'utf-8');
    return JSON.parse(raw);
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      const fallbackRaw = readFileSync(examplePath, 'utf-8');
      return JSON.parse(fallbackRaw);
    }
    if (error instanceof SyntaxError) {
      throw new Error(`scripts/config.json invalid JSON: ${error.message}`);
    }
    throw error;
  }
}

const scriptConfig = loadScriptsConfig();
const stressConfig = scriptConfig.stressSeed || {};

const WS_URL = String(stressConfig.wsUrl || 'ws://127.0.0.1:8816/ws').trim();
const ADMIN_NICKNAME = String(stressConfig.adminNickname || 'lisov').trim().toLowerCase();
const ADMIN_PASSWORD = String(stressConfig.adminPassword || '123');
const DEFAULT_USER_PASSWORD = String(stressConfig.defaultUserPassword || '123');

const STRESS_USER_COUNT = Number.parseInt(String(stressConfig.userCount || 100), 10);
const GENERAL_MESSAGE_COUNT = Number.parseInt(String(stressConfig.generalMessages || 10000), 10);
const DIRECT_DIALOGS_COUNT = Number.parseInt(String(stressConfig.directDialogs || 50), 10);
const DIRECT_MESSAGES_PER_DIALOG = Number.parseInt(String(stressConfig.directMessagesPerDialog || 24), 10);

const IMAGE_URLS = [
  'https://cs8.pikabu.ru/post_img/2016/09/16/10/og_og_1474048544294839279.jpg',
  'https://images.unsplash.com/photo-1518770660439-4636190af475?auto=format&fit=crop&w=1200&q=80',
  'https://images.unsplash.com/photo-1470225620780-dba8ba36b745?auto=format&fit=crop&w=1200&q=80',
  'https://upload.wikimedia.org/wikipedia/commons/thumb/3/3f/Fronalpstock_big.jpg/1280px-Fronalpstock_big.jpg',
];

const VIDEO_URLS = [
  'https://www.youtube.com/watch?v=LW4X1DvNDNo',
  'https://www.w3schools.com/html/mov_bbb.mp4',
  'https://samplelib.com/lib/preview/mp4/sample-5s.mp4',
];

class WsRpcClient {
  constructor(url) {
    this.url = url;
    this.ws = null;
    this.pending = new Map();
    this.requestSeq = 0;
    this.isOpen = false;
  }

  async connect() {
    if (this.isOpen && this.ws && this.ws.readyState === WebSocket.OPEN) return;

    await new Promise((resolve, reject) => {
      const ws = new WebSocket(this.url);
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        try {
          ws.close();
        } catch {}
        reject(new Error(`WS timeout: ${this.url}`));
      }, 8000);

      ws.onopen = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.ws = ws;
        this.isOpen = true;
        resolve();
      };

      ws.onerror = (event) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(new Error(`WS connect failed: ${event?.message || 'unknown'}`));
      };

      ws.onmessage = (event) => {
        this.handleMessage(event?.data?.toString?.() || '');
      };

      ws.onclose = () => {
        this.isOpen = false;
        for (const [id, handlers] of this.pending.entries()) {
          clearTimeout(handlers.timer);
          handlers.reject(new Error(`WS closed before response (${id})`));
        }
        this.pending.clear();
      };
    });
  }

  handleMessage(raw) {
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }
    if (!Array.isArray(parsed)) return;
    const com = parsed[0];
    if (com !== '[res]') return;
    const requestId = parsed[4];
    if (!requestId || !this.pending.has(requestId)) return;
    const pending = this.pending.get(requestId);
    this.pending.delete(requestId);
    clearTimeout(pending.timer);
    pending.resolve(Array.isArray(parsed[1]) ? parsed[1][0] : undefined);
  }

  async request(com, ...args) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error(`WS is not open for request ${com}`);
    }
    const requestId = `r${Date.now()}_${++this.requestSeq}`;
    const packet = [com, args, 'frontend', 'backend', requestId];

    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error(`RPC timeout: ${com}`));
      }, 20000);

      this.pending.set(requestId, {resolve, reject, timer});
      try {
        this.ws.send(JSON.stringify(packet));
      } catch (err) {
        clearTimeout(timer);
        this.pending.delete(requestId);
        reject(err);
      }
    });
  }

  async close() {
    if (!this.ws) return;
    try {
      this.ws.close();
    } catch {}
    this.ws = null;
    this.isOpen = false;
  }
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function log(message) {
  const stamp = new Date().toISOString();
  process.stdout.write(`[${stamp}] ${message}\n`);
}

function ensureOk(result, context) {
  if (!result || typeof result !== 'object') {
    throw new Error(`${context}: empty response`);
  }
  if (Object.prototype.hasOwnProperty.call(result, 'ok') && result.ok === false) {
    throw new Error(`${context}: ${result.error || 'unknown_error'}`);
  }
  return result;
}

function stressNickname(index) {
  return `stress${String(index).padStart(3, '0')}`;
}

function buildGeneralMessage(index, senderNickname) {
  if (index % 37 === 0) {
    const imageUrl = IMAGE_URLS[index % IMAGE_URLS.length];
    return `img-${index}\n${imageUrl}\nfooter-${senderNickname}-${index}`;
  }
  if (index % 53 === 0) {
    const videoUrl = VIDEO_URLS[index % VIDEO_URLS.length];
    return `video-${index}\n${videoUrl}`;
  }
  if (index % 11 === 0) {
    return `b(стресс ${index}) u(подчёркнутый) s(зачёркнутый) h(секрет-${index})`;
  }
  if (index % 17 === 0) {
    return `m(const n = ${index} < ${index + 1}) c#red(красный) c#61afef(небо)`;
  }
  if (index % 29 === 0) {
    return `@all пинг ${index} от @${senderNickname}`;
  }
  return `msg-${index} от @${senderNickname}`;
}

function buildDirectMessage(index, authorNickname, targetNickname) {
  if (index % 9 === 0) {
    const imageUrl = IMAGE_URLS[index % IMAGE_URLS.length];
    return `@${targetNickname}, глянь\n${imageUrl}`;
  }
  if (index % 13 === 0) {
    return `b(приват ${index}) c#blue(проверка) @${targetNickname}`;
  }
  if (index % 17 === 0) {
    const videoUrl = VIDEO_URLS[index % VIDEO_URLS.length];
    return `ссылка на видео ${index}\n${videoUrl}`;
  }
  return `direct-${index} @${targetNickname} от @${authorNickname}`;
}

async function createUserByInvite(adminClient, nickname, password, name) {
  const invite = ensureOk(await adminClient.request('invites:create'), `invites:create(${nickname})`);
  if (!invite.code) {
    throw new Error(`invites:create(${nickname}): no code`);
  }

  const guest = new WsRpcClient(WS_URL);
  await guest.connect();
  try {
    const redeemed = await guest.request('invites:redeem', {
      code: invite.code,
      nickname,
      password,
      name,
    });

    if (redeemed?.ok === false && redeemed?.error === 'nickname_taken') {
      return {created: false};
    }

    ensureOk(redeemed, `invites:redeem(${nickname})`);
    return {created: true};
  } finally {
    await guest.close();
  }
}

async function getOrCreateAuthedClient(nickname, password, pool) {
  const key = nickname.toLowerCase();
  if (pool.has(key)) return pool.get(key);

  const client = new WsRpcClient(WS_URL);
  await client.connect();
  const auth = ensureOk(
    await client.request('auth:login', {nickname: key, password}),
    `auth:login(${key})`,
  );
  if (!auth.user?.id) {
    throw new Error(`auth:login(${key}): user id not found`);
  }

  pool.set(key, client);
  return client;
}

async function main() {
  log(`WS: ${WS_URL}`);
  log(`Target: users=${STRESS_USER_COUNT}, generalMessages=${GENERAL_MESSAGE_COUNT}, directs=${DIRECT_DIALOGS_COUNT}`);

  const admin = new WsRpcClient(WS_URL);
  await admin.connect();

  const adminAuth = ensureOk(
    await admin.request('auth:login', {nickname: ADMIN_NICKNAME, password: ADMIN_PASSWORD}),
    `auth:login(${ADMIN_NICKNAME})`,
  );
  const adminId = adminAuth.user?.id;
  if (!adminId) {
    throw new Error('Admin user id not found');
  }

  log(`Admin auth ok: @${ADMIN_NICKNAME} id=${adminId}`);

  const allDesiredNicknames = [];
  for (let i = 1; i <= STRESS_USER_COUNT; i += 1) {
    allDesiredNicknames.push(stressNickname(i));
  }

  let users = ensureOk(await admin.request('users:list'), 'users:list(initial)');
  const existingSet = new Set(
    users.map((user) => String(user.nickname || '').toLowerCase()).filter(Boolean),
  );
  existingSet.add(ADMIN_NICKNAME);

  if (!existingSet.has('mike')) {
    log('User @mike not found, creating...');
    await createUserByInvite(admin, 'mike', DEFAULT_USER_PASSWORD, 'mike');
    log('User @mike ready');
  }

  let createdUsers = 0;
  for (const nickname of allDesiredNicknames) {
    if (existingSet.has(nickname)) continue;
    await createUserByInvite(admin, nickname, DEFAULT_USER_PASSWORD, nickname);
    existingSet.add(nickname);
    createdUsers += 1;
    if (createdUsers % 10 === 0) {
      log(`Created users: ${createdUsers}`);
    }
    await delay(5);
  }
  log(`Users created this run: ${createdUsers}`);

  users = ensureOk(await admin.request('users:list'), 'users:list(after-create)');
  const byNickname = new Map();
  for (const user of users) {
    byNickname.set(String(user.nickname || '').toLowerCase(), user);
  }
  byNickname.set(ADMIN_NICKNAME, adminAuth.user);

  if (!byNickname.has('mike')) {
    throw new Error('User @mike is still missing after create');
  }

  for (const nickname of allDesiredNicknames) {
    if (!byNickname.has(nickname)) {
      throw new Error(`Missing stress user after create: @${nickname}`);
    }
  }

  const general = ensureOk(await admin.request('dialogs:general'), 'dialogs:general');
  const generalDialogId = Number(general.dialogId);
  if (!Number.isFinite(generalDialogId)) {
    throw new Error('General dialog id is invalid');
  }
  log(`General dialog id=${generalDialogId}`);

  const senderNicknames = [
    'lisov',
    'mike',
    ...allDesiredNicknames.slice(0, Math.min(58, allDesiredNicknames.length)),
  ];

  const clientPool = new Map();
  const senderClients = [];
  for (const nickname of senderNicknames) {
    const client = await getOrCreateAuthedClient(nickname, DEFAULT_USER_PASSWORD, clientPool);
    senderClients.push({nickname, client});
  }
  log(`Sender clients connected: ${senderClients.length}`);

  for (let i = 0; i < GENERAL_MESSAGE_COUNT; i += 1) {
    const sender = senderClients[i % senderClients.length];
    const text = buildGeneralMessage(i + 1, sender.nickname);
    const result = await sender.client.request('chat:send', generalDialogId, text);
    ensureOk(result, `chat:send(general,#${i + 1})`);

    if ((i + 1) % 500 === 0) {
      log(`General messages sent: ${i + 1}/${GENERAL_MESSAGE_COUNT}`);
    }
  }
  log(`General chat seeded: ${GENERAL_MESSAGE_COUNT} messages`);

  const lisovUser = byNickname.get('lisov');
  const mikeUser = byNickname.get('mike');
  if (!lisovUser?.id || !mikeUser?.id) {
    throw new Error('lisov/mike ids are missing');
  }

  let directMessagesSent = 0;
  for (let i = 0; i < DIRECT_DIALOGS_COUNT; i += 1) {
    const leftNickname = i < Math.floor(DIRECT_DIALOGS_COUNT / 2) ? 'lisov' : 'mike';
    const rightIndex = i % allDesiredNicknames.length;
    const rightNickname = allDesiredNicknames[rightIndex];

    const leftUser = byNickname.get(leftNickname);
    const rightUser = byNickname.get(rightNickname);
    if (!leftUser?.id || !rightUser?.id) {
      throw new Error(`Direct pair invalid: ${leftNickname} <-> ${rightNickname}`);
    }

    const leftClient = await getOrCreateAuthedClient(leftNickname, DEFAULT_USER_PASSWORD, clientPool);
    const rightClient = await getOrCreateAuthedClient(rightNickname, DEFAULT_USER_PASSWORD, clientPool);

    const direct = ensureOk(
      await leftClient.request('dialogs:private', rightUser.id),
      `dialogs:private(${leftNickname},${rightNickname})`,
    );
    const dialogId = Number(direct.dialogId);
    if (!Number.isFinite(dialogId)) {
      throw new Error(`Direct dialog id invalid for ${leftNickname} <-> ${rightNickname}`);
    }

    for (let j = 0; j < DIRECT_MESSAGES_PER_DIALOG; j += 1) {
      const fromLeft = j % 2 === 0;
      const authorNickname = fromLeft ? leftNickname : rightNickname;
      const targetNickname = fromLeft ? rightNickname : leftNickname;
      const authorClient = fromLeft ? leftClient : rightClient;
      const text = buildDirectMessage(j + 1, authorNickname, targetNickname);
      const sent = await authorClient.request('chat:send', dialogId, text);
      ensureOk(sent, `chat:send(direct:${dialogId},#${j + 1})`);
      directMessagesSent += 1;
    }

    log(`Direct ${i + 1}/${DIRECT_DIALOGS_COUNT} done: @${leftNickname} <-> @${rightNickname}, dialog=${dialogId}`);
  }

  log(`Direct dialogs seeded: ${DIRECT_DIALOGS_COUNT}, messages=${directMessagesSent}`);

  const totalUsersInDb = ensureOk(await admin.request('users:list'), 'users:list(final)').length + 1;
  log(`Final users (incl admin): ${totalUsersInDb}`);
  log('Stress seed completed successfully');

  for (const client of clientPool.values()) {
    await client.close();
  }
  await admin.close();
}

main().catch(async (err) => {
  process.stderr.write(`${err?.stack || err?.message || String(err)}\n`);
  process.exit(1);
});
