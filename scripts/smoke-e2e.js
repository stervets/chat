#!/usr/bin/env node

const {spawn, spawnSync} = require('node:child_process');
const {existsSync, rmSync} = require('node:fs');
const path = require('node:path');
const {chromium} = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const DB_PATH = path.join(ROOT, 'backend', 'data', 'marx.sqlite');
const BACKEND_WS_URL = 'ws://localhost:8816/ws';
const FRONTEND_URL = 'http://localhost:8815';
const BASE_URL = 'http://localhost:8815';

const log = (msg) => process.stdout.write(`${msg}\n`);
const err = (msg) => process.stderr.write(`${msg}\n`);

const waitForUrl = async (url, timeoutMs) => {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url, {method: 'GET'});
      if (res.ok) return true;
    } catch {
      // ignore
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
};

const waitForWs = async (url, timeoutMs) => {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const ok = await new Promise((resolve) => {
        const ws = new WebSocket(url);
        const timer = setTimeout(() => {
          try {
            ws.close();
          } catch {}
          resolve(false);
        }, 1000);

        ws.onopen = () => {
          clearTimeout(timer);
          ws.close();
          resolve(true);
        };

        ws.onerror = () => {
          clearTimeout(timer);
          resolve(false);
        };
      });

      if (ok) return true;
    } catch {
      // ignore
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
};

const isWsUp = async (url) => {
  try {
    const ws = new WebSocket(url);
    return await new Promise((resolve) => {
      const timer = setTimeout(() => {
        try {
          ws.close();
        } catch {}
        resolve(false);
      }, 800);

      ws.onopen = () => {
        clearTimeout(timer);
        ws.close();
        resolve(true);
      };
      ws.onerror = () => {
        clearTimeout(timer);
        resolve(false);
      };
    });
  } catch {
    return false;
  }
};

const isUrlUp = async (url) => {
  try {
    const res = await fetch(url, {method: 'GET'});
    return res.ok || res.status >= 200;
  } catch {
    return false;
  }
};

const runSync = (cmd, args, opts) => {
  const result = spawnSync(cmd, args, {stdio: 'inherit', ...opts});
  if (result.status !== 0) {
    throw new Error(`Command failed: ${cmd} ${args.join(' ')}`);
  }
};

const startProcess = (name, cmd, args, opts) => {
  const child = spawn(cmd, args, {stdio: 'inherit', ...opts});
  child.on('exit', (code) => {
    if (code !== 0) {
      err(`${name} exited with code ${code}`);
    }
  });
  return child;
};

const stopProcess = async (child, name) => {
  if (!child || child.killed) return;
  child.kill('SIGINT');
  await new Promise((r) => setTimeout(r, 500));
  if (!child.killed) {
    child.kill('SIGTERM');
  }
  log(`${name} stopped`);
};

async function login(page, nickname, password) {
  await page.goto(`${BASE_URL}/login`, {waitUntil: 'networkidle'});
  await page.getByPlaceholder('nickname').fill(nickname);
  await page.getByPlaceholder('password').fill(password);
  await page.getByRole('button', {name: 'Login'}).click();
  await page.waitForURL('**/chat', {timeout: 30000});
}

async function sendMessage(page, text) {
  await page.getByPlaceholder('Сообщение...').fill(text);
  await page.getByRole('button', {name: 'Отправить'}).click();
}

async function ensureNoError(page) {
  const errorCount = await page.locator('.error').count();
  if (errorCount > 0) {
    const msg = await page.locator('.error').first().textContent();
    throw new Error(`UI error: ${(msg || '').trim()}`);
  }
}

async function waitForChatOrError(page) {
  const chatPromise = page.waitForURL('**/chat', {timeout: 30000}).then(() => 'chat');
  const errorPromise = page.waitForSelector('.error', {timeout: 30000}).then(async () => {
    const msg = await page.locator('.error').textContent();
    return `error:${(msg || '').trim()}`;
  });
  return Promise.race([chatPromise, errorPromise]);
}

async function openPrivate(page, nickname) {
  await page.getByRole('button', {name: 'Директы'}).click();
  const button = page.getByRole('button', {name: nickname});
  await button.waitFor({timeout: 30000});
  await button.click();
}

(async () => {
  if (await isWsUp(BACKEND_WS_URL) || await isUrlUp(FRONTEND_URL)) {
    throw new Error('Ports 8815/8816 are busy. Stop running servers and retry.');
  }

  log('Reset DB');
  if (existsSync(DB_PATH)) rmSync(DB_PATH, {force: true});

  log('Bootstrap first user');
  runSync('yarn', ['run', 'user:bootstrap', '--', '--nickname', 'owner', '--password', 'pass1'], {cwd: ROOT});

  log('Start backend');
  const backend = startProcess('backend', 'yarn', ['run', 'backend:dev'], {cwd: ROOT});
  if (!await waitForWs(BACKEND_WS_URL, 20000)) {
    await stopProcess(backend, 'backend');
    throw new Error('Backend did not start');
  }

  log('Start frontend');
  const frontend = startProcess('frontend', 'yarn', ['run', 'frontend:dev'], {cwd: ROOT});
  if (!await waitForUrl(FRONTEND_URL, 30000)) {
    await stopProcess(frontend, 'frontend');
    await stopProcess(backend, 'backend');
    throw new Error('Frontend did not start');
  }

  log('Run headless flow');
  const browser = await chromium.launch({
    ...(process.env.PW_EXECUTABLE_PATH
      ? {executablePath: process.env.PW_EXECUTABLE_PATH}
      : {channel: process.env.PW_CHANNEL || 'chromium'}),
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-crash-reporter',
      '--disable-breakpad',
      '--disable-crashpad',
    ],
  });
  try {
    const ctx1 = await browser.newContext();
    const page1 = await ctx1.newPage();

    await login(page1, 'owner', 'pass1');
    await sendMessage(page1, 'hello-from-owner');
    await page1.waitForSelector('text=hello-from-owner', {timeout: 30000});
    await ensureNoError(page1);

    const invitePage = await ctx1.newPage();
    await invitePage.goto(`${BASE_URL}/invites`, {waitUntil: 'networkidle'});
    await invitePage.getByRole('button', {name: 'Создать инвайт'}).click();
    const linkEl = invitePage.locator('.invite-link .link');
    await linkEl.waitFor({timeout: 10000});
    const inviteLink = (await linkEl.textContent())?.trim();
    if (!inviteLink || !inviteLink.includes('/invite/')) {
      throw new Error(`Invite link not found: ${inviteLink}`);
    }

    const ctx2 = await browser.newContext();
    const page2 = await ctx2.newPage();
    await page2.goto(inviteLink, {waitUntil: 'networkidle'});
    await page2.getByPlaceholder('nickname').fill('user2');
    await page2.getByPlaceholder('password').fill('pass2');
    await page2.getByRole('button', {name: 'Register'}).click();

    const result = await waitForChatOrError(page2);
    if (result !== 'chat') {
      throw new Error(`Register failed: ${result} (url=${page2.url()})`);
    }

    await page2.waitForSelector('text=hello-from-owner', {timeout: 30000});
    await sendMessage(page2, 'hello-from-user2');
    await page2.waitForSelector('text=hello-from-user2', {timeout: 30000});
    await ensureNoError(page2);

    await page1.waitForSelector('text=hello-from-user2', {timeout: 30000});

    // refresh owner to pick up new user list
    await page1.reload({waitUntil: 'networkidle'});
    await openPrivate(page1, 'user2');
    await sendMessage(page1, 'private-from-owner');
    await page1.waitForSelector('text=private-from-owner', {timeout: 30000});

    await openPrivate(page2, 'owner');
    await page2.waitForSelector('text=private-from-owner', {timeout: 30000});

    log(`Flow OK. Invite link: ${inviteLink}`);
  } finally {
    await browser.close();
    await stopProcess(frontend, 'frontend');
    await stopProcess(backend, 'backend');
  }
})().catch((e) => {
  err(`Smoke failed: ${e.message || e}`);
  process.exit(1);
});
