#!/usr/bin/env node

const {spawn, spawnSync} = require('node:child_process');
const path = require('node:path');
const {readFileSync} = require('node:fs');
const {chromium} = require('playwright');

const ROOT = path.resolve(__dirname, '..');

const loadScriptsConfig = () => {
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
};

const scriptConfig = loadScriptsConfig();
const smokeConfig = scriptConfig.smokeE2E || {};
const smokeBrowserConfig = smokeConfig.browser || {};

const BACKEND_WS_URL = String(smokeConfig.backendWsUrl || 'ws://localhost:8816/ws').trim();
const FRONTEND_URL = String(smokeConfig.frontendUrl || 'http://localhost:8815').trim();
const BASE_URL = String(smokeConfig.baseUrl || 'http://localhost:8815').trim();
const BROWSER_CHANNEL = String(smokeBrowserConfig.channel || 'chromium').trim();
const BROWSER_EXECUTABLE_PATH = String(smokeBrowserConfig.executablePath || '').trim();

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
  await dismissSoundOverlayIfVisible(page);
  await page.getByPlaceholder('Сообщение...').fill(text);
  await dismissSoundOverlayIfVisible(page);
  await page.getByRole('button', {name: /Отправить/i}).click();
}

async function dismissSoundOverlayIfVisible(page) {
  const overlay = page.locator('.sound-overlay');
  const visible = await overlay.isVisible({timeout: 1000}).catch(() => false);
  if (!visible) return;

  await overlay.locator('.sound-overlay-btn').first().click({timeout: 5000});
  await overlay.waitFor({state: 'hidden', timeout: 10000});
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
  const opened = await page.locator('.drawer-left.open').count();
  if (!opened) {
    await page.getByRole('button', {name: '☰'}).click();
  }

  const drawer = page.locator('.drawer-left');
  let button = drawer.getByRole('button', {name: new RegExp(nickname, 'i')}).first();
  const foundInDirects = await button.isVisible({timeout: 1500}).catch(() => false);

  if (!foundInDirects) {
    const search = drawer.getByPlaceholder('Найти пользователя...');
    await search.fill(nickname);
    button = drawer.getByRole('button', {name: new RegExp(nickname, 'i')}).first();
    await button.waitFor({timeout: 30000});
  }

  await button.click();
  if (await page.locator('.drawer-backdrop').count()) {
    await page.locator('.drawer-backdrop').waitFor({state: 'hidden', timeout: 10000});
  }
}

async function closeLeftDrawerIfOpen(page) {
  const opened = await page.locator('.drawer-left.open').count();
  if (!opened) return;
  const drawerClose = page.locator('.drawer-left.open .drawer-close').first();
  const canUseDrawerClose = await drawerClose.isVisible({timeout: 1000}).catch(() => false);
  if (canUseDrawerClose) {
    await drawerClose.click();
  } else {
    await page.getByRole('button', {name: '☰'}).click({force: true});
  }
  await page.waitForSelector('.drawer-left.open', {state: 'hidden', timeout: 10000}).catch(() => {});
}

(async () => {
  if (await isWsUp(BACKEND_WS_URL) || await isUrlUp(FRONTEND_URL)) {
    throw new Error('Ports 8815/8816 are busy. Stop running servers and retry.');
  }

  log('Reset PostgreSQL DB');
  runSync('yarn', ['run', 'db:reset'], {cwd: path.join(ROOT, 'backend')});

  log('Bootstrap first user');
  runSync('yarn', ['run', 'user:bootstrap', '--nickname', 'lisov', '--password', '123'], {cwd: ROOT});

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
    ...(BROWSER_EXECUTABLE_PATH
      ? {executablePath: BROWSER_EXECUTABLE_PATH}
      : {channel: BROWSER_CHANNEL}),
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

    await login(page1, 'lisov', '123');
    await dismissSoundOverlayIfVisible(page1);
    await closeLeftDrawerIfOpen(page1);
    await sendMessage(page1, 'hello-from-lisov');
    await page1.waitForSelector('text=hello-from-lisov', {timeout: 30000});
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
    await page2.getByPlaceholder('nickname').fill('mike');
    await page2.getByPlaceholder('password').fill('123');
    await page2.getByRole('button', {name: 'Register'}).click();

    const result = await waitForChatOrError(page2);
    if (result !== 'chat') {
      throw new Error(`Register failed: ${result} (url=${page2.url()})`);
    }
    await dismissSoundOverlayIfVisible(page2);
    await closeLeftDrawerIfOpen(page2);

    await page2.waitForSelector('text=hello-from-lisov', {timeout: 30000});
    await sendMessage(page2, 'hello-from-mike');
    await page2.waitForSelector('text=hello-from-mike', {timeout: 30000});
    await ensureNoError(page2);

    await page1.waitForSelector('text=hello-from-mike', {timeout: 30000});
    await page1.reload({waitUntil: 'networkidle'});
    await dismissSoundOverlayIfVisible(page1);
    await page1.waitForSelector('text=hello-from-mike', {timeout: 30000});

    await sendMessage(page2, '@all ping-everyone');
    await page1.waitForSelector('text=@all ping-everyone', {timeout: 30000});
    const mentionClass = await page1.locator('.message', {hasText: '@all ping-everyone'}).last().getAttribute('class');
    if (!mentionClass || !mentionClass.includes('message-mention-me')) {
      throw new Error('Message with @all keyword was not highlighted');
    }

    const imageUrl = 'https://cs8.pikabu.ru/post_img/2016/09/16/10/og_og_1474048544294839279.jpg';
    await sendMessage(page2, imageUrl);
    await page1.waitForSelector(`img.preview-image[src="${imageUrl}"]`, {timeout: 30000, state: 'attached'});
    const imageMessage = page1.locator('.message').filter({
      has: page1.locator(`img.preview-image[src="${imageUrl}"]`),
    }).last();
    const imageLinkInBody = imageMessage.locator(`.message-body a[href="${imageUrl}"]`);
    const imageLinkCount = await imageLinkInBody.count();
    if (imageLinkCount !== 1) {
      throw new Error(`Expected one clickable image link, got ${imageLinkCount}`);
    }
    const imageLinkText = ((await imageLinkInBody.first().textContent()) || '').trim();
    if (imageLinkText === imageUrl) {
      throw new Error('Image URL text should be hidden in message body when preview is rendered');
    }

    await page1.reload({waitUntil: 'networkidle'});
    await dismissSoundOverlayIfVisible(page1);
    await page1.waitForSelector(`img.preview-image[src="${imageUrl}"]`, {timeout: 30000, state: 'attached'});
    const imageMessageAfterReload = page1.locator('.message').filter({
      has: page1.locator(`img.preview-image[src="${imageUrl}"]`),
    }).last();
    const imageLinkAfterReload = imageMessageAfterReload.locator(`.message-body a[href="${imageUrl}"]`);
    const imageLinkAfterReloadCount = await imageLinkAfterReload.count();
    if (imageLinkAfterReloadCount !== 1) {
      throw new Error(`Expected one clickable image link after reload, got ${imageLinkAfterReloadCount}`);
    }
    const imageLinkTextAfterReload = ((await imageLinkAfterReload.first().textContent()) || '').trim();
    if (imageLinkTextAfterReload === imageUrl) {
      throw new Error('Image URL text should stay hidden after reload');
    }

    const formattedRaw = 'b(жир) u(подч) s(зач) h(секрет) m(<x>) c#FF00FF(цвет)';
    await sendMessage(page1, formattedRaw);
    await page2.waitForSelector('text=жир', {timeout: 30000});
    const formattedMessage = page2.locator('.message', {hasText: 'жир'}).last();
    const formattedHtml = await formattedMessage.locator('.message-rendered-html').innerHTML();
    if (!formattedHtml.includes('<strong>жир</strong>')) throw new Error('Strong formatting failed');
    if (!formattedHtml.includes('<u>подч</u>')) throw new Error('Underline formatting failed');
    if (!formattedHtml.includes('<s>зач</s>')) throw new Error('Strike formatting failed');
    if (!formattedHtml.includes('class="message-spoiler"')) throw new Error('Spoiler formatting failed');
    if (!formattedHtml.includes('<code>&lt;x&gt;</code>')) throw new Error('Monospace formatting failed');
    if (!formattedHtml.includes('style="color:#FF00FF"')) throw new Error('Color formatting failed');

    const ytUrl = 'https://www.youtube.com/watch?v=LW4X1DvNDNo';
    await sendMessage(page2, ytUrl);
    await page1.waitForSelector('iframe.preview-youtube-embed[src*="youtube.com/embed/LW4X1DvNDNo"]', {timeout: 30000, state: 'attached'});

    const reactionTarget = `reaction-target-${Date.now()}`;
    await sendMessage(page1, reactionTarget);
    await page2.waitForSelector(`text=${reactionTarget}`, {timeout: 30000});

    await closeLeftDrawerIfOpen(page2);
    const reactionMessagePage2 = page2.locator('.message', {hasText: reactionTarget}).last();
    await reactionMessagePage2.locator('.reaction-add-btn').click();
    await reactionMessagePage2.locator('.reaction-picker-item', {hasText: '🔥'}).click();
    await reactionMessagePage2.locator('.reaction-chip', {hasText: '🔥'}).waitFor({state: 'visible', timeout: 30000});

    const reactionMessagePage1 = page1.locator('.message', {hasText: reactionTarget}).last();
    await reactionMessagePage1.locator('.reaction-chip', {hasText: '🔥'}).waitFor({state: 'visible', timeout: 30000});

    await reactionMessagePage2.locator('.reaction-chip', {hasText: '🔥'}).click();
    await reactionMessagePage2.locator('.reaction-chip', {hasText: '🔥'}).waitFor({state: 'detached', timeout: 30000});
    await reactionMessagePage1.locator('.reaction-chip', {hasText: '🔥'}).waitFor({state: 'detached', timeout: 30000});

    const editableText = `editable-from-lisov-${Date.now()}`;
    await sendMessage(page1, editableText);
    await page2.waitForSelector(`text=${editableText}`, {timeout: 30000});
    const editableMessagePage1 = page1.locator('.message', {hasText: editableText}).last();
    await editableMessagePage1.locator('.message-inline-btn', {hasText: 'ред.'}).click();
    const editedText = `${editableText}-edited`;
    await page1.locator('.message-edit-input').last().fill(editedText);
    await page1.locator('.message-edit-save').last().click();
    await page1.waitForSelector(`text=${editedText}`, {timeout: 30000});
    await page2.waitForSelector(`text=${editedText}`, {timeout: 30000});

    const editedMessagePage1 = page1.locator('.message', {hasText: editedText}).last();
    page1.once('dialog', (dialog) => dialog.accept());
    await editedMessagePage1.locator('.message-inline-btn', {hasText: 'удал.'}).click();
    await page1.waitForSelector(`text=${editedText}`, {state: 'detached', timeout: 30000});
    await page2.waitForSelector(`text=${editedText}`, {state: 'detached', timeout: 30000});

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
