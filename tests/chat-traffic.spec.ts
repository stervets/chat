import {test, expect, type Page} from '@playwright/test';
const {
  CONFIG,
  WsRpcClient,
  assertNoApiError,
  loginByPassword,
} = require('./helpers/e2e');

const BASE_URL = 'http://127.0.0.1:8815';

function createRequestCollector(page: Page) {
  return {
    async snapshot() {
      return page.evaluate(() => {
        return Array.isArray((window as any).__wsPackets) ? (window as any).__wsPackets.length : 0;
      });
    },
    async slice(from: number) {
      return page.evaluate((start) => {
        const packets = Array.isArray((window as any).__wsPackets) ? (window as any).__wsPackets : [];
        return packets.slice(start);
      }, from);
    },
    async count(com: string, from = 0) {
      return page.evaluate(({targetCom, start}) => {
        const packets = Array.isArray((window as any).__wsPackets) ? (window as any).__wsPackets : [];
        return packets.slice(start).filter((entry: any) => entry?.com === targetCom).length;
      }, {targetCom: com, start: from});
    },
    async total(com: string) {
      return page.evaluate((targetCom) => {
        const packets = Array.isArray((window as any).__wsPackets) ? (window as any).__wsPackets : [];
        return packets.filter((entry: any) => entry?.com === targetCom).length;
      }, com);
    },
    async all() {
      return page.evaluate(() => {
        return Array.isArray((window as any).__wsPackets) ? (window as any).__wsPackets : [];
      });
    },
  };
}

async function waitForWsIdle(page: Page, ms = 900) {
  await page.waitForTimeout(ms);
}

async function login(page: Page, nickname: string, password: string) {
  await page.goto(`${BASE_URL}/login`, {waitUntil: 'networkidle'});
  await page.getByPlaceholder('nickname').fill(nickname);
  await page.getByPlaceholder('password').fill(password);
  await page.getByRole('button', {name: 'Login'}).click();
  await page.waitForURL('**/chat**', {timeout: 30000});
}

async function openLeftDrawer(page: Page) {
  const drawer = page.locator('.drawer-left');
  if (await drawer.evaluate((node) => node.classList.contains('open')).catch(() => false)) {
    return;
  }
  await page.locator('.menu-toggle-btn').click();
  await expect(drawer).toHaveClass(/open/);
}

async function switchToDirects(page: Page) {
  await openLeftDrawer(page);
  await page.getByRole('button', {name: 'Директы'}).click();
}

async function switchToRooms(page: Page) {
  await openLeftDrawer(page);
  await page.getByRole('button', {name: 'Комнаты'}).click();
}

async function openDirectFromSearch(page: Page, nickname: string) {
  await switchToDirects(page);
  const search = page.getByPlaceholder('Найти директ или пользователя...');
  await search.fill(nickname);
  await page.locator('.users-list .menu-item').filter({hasText: new RegExp(nickname, 'i')}).first().click();
  await expect(page.locator('.drawer-left')).not.toHaveClass(/open/);
}

async function openRoomByTitle(page: Page, title: string) {
  await switchToRooms(page);
  await page.getByPlaceholder('Найти комнату...').fill(title);
  await page.locator('.menu-list .menu-item').filter({hasText: title}).first().click();
  await expect(page.locator('.drawer-left')).not.toHaveClass(/open/);
}

async function sendMessage(page: Page, text: string) {
  await page.getByPlaceholder('Сообщение...').fill(text);
  await page.locator('.send-btn').click();
}

test('chat traffic stays minimal across login, switches and direct/group messaging', async ({browser}) => {
  const adminClient = new WsRpcClient(CONFIG.backendWsUrl);
  await adminClient.connect();
  let directRoomId = 0;
  try {
    await loginByPassword(adminClient, 'lisov', '123');
    const marxUser = assertNoApiError(await adminClient.request('user:get', {
      nickname: 'marx',
    }), 'user:get marx');
    const directRoom = assertNoApiError(await adminClient.request('room:direct:get-or-create', {
      userId: Number(marxUser.user?.id || 0),
    }), 'room:direct:get-or-create marx');
    directRoomId = Number(directRoom.roomId || 0);
    expect(directRoomId).toBeGreaterThan(0);
  } finally {
    await adminClient.close();
  }

  const contextLisov = await browser.newContext();
  const contextMarx = await browser.newContext();
  const lisovPage = await contextLisov.newPage();
  const marxPage = await contextMarx.newPage();
  await lisovPage.addInitScript(() => {
    const key = '__wsPackets';
    (window as any)[key] = [];
    const originalSend = WebSocket.prototype.send;
    WebSocket.prototype.send = function patchedSend(data: any) {
      try {
        const parsed = JSON.parse(String(data || ''));
        if (Array.isArray(parsed) && typeof parsed[0] === 'string') {
          (window as any)[key].push({
            com: parsed[0],
            args: parsed[1],
            senderId: parsed[2],
            recipientId: parsed[3],
            requestId: parsed[4] || '',
          });
        }
      } catch {
        // ignore malformed frames
      }
      return originalSend.call(this, data);
    };
  });
  await marxPage.addInitScript(() => {
    const key = '__wsPackets';
    (window as any)[key] = [];
    const originalSend = WebSocket.prototype.send;
    WebSocket.prototype.send = function patchedSend(data: any) {
      try {
        const parsed = JSON.parse(String(data || ''));
        if (Array.isArray(parsed) && typeof parsed[0] === 'string') {
          (window as any)[key].push({
            com: parsed[0],
            args: parsed[1],
            senderId: parsed[2],
            recipientId: parsed[3],
            requestId: parsed[4] || '',
          });
        }
      } catch {
        // ignore malformed frames
      }
      return originalSend.call(this, data);
    };
  });
  const lisovRequests = createRequestCollector(lisovPage);
  const marxRequests = createRequestCollector(marxPage);

  await login(lisovPage, 'lisov', '123');
  await waitForWsIdle(lisovPage);
  const defaultRoomTitle = String(await lisovPage.locator('.title-button').textContent() || '').trim();
  expect(defaultRoomTitle.length).toBeGreaterThan(0);
  await openLeftDrawer(lisovPage);
  expect(await lisovPage.locator('.menu-list .menu-item').count()).toBeGreaterThan(0);

  expect(await lisovRequests.total('user:list')).toBe(1);
  expect(await lisovRequests.total('contacts:list')).toBe(1);
  expect(await lisovRequests.total('room:list')).toBe(3);
  expect(await lisovRequests.total('room:group:get-default')).toBeLessThanOrEqual(1);

  const beforeOpenDirect = await lisovRequests.snapshot();
  await openDirectFromSearch(lisovPage, 'marx');
  await waitForWsIdle(lisovPage);
  expect(await lisovRequests.count('room:direct:get-or-create', beforeOpenDirect)).toBe(1);
  expect(await lisovRequests.count('message:list', beforeOpenDirect)).toBe(1);
  expect(await lisovRequests.count('room:get', beforeOpenDirect)).toBe(1);
  expect(await lisovRequests.count('contacts:list', beforeOpenDirect)).toBe(0);
  expect(await lisovRequests.count('user:list', beforeOpenDirect)).toBe(0);
  expect(await lisovRequests.count('room:list', beforeOpenDirect)).toBe(0);

  await login(marxPage, 'marx', '123');
  await waitForWsIdle(marxPage);
  await marxPage.goto(`${BASE_URL}/chat?room=${directRoomId}`, {waitUntil: 'networkidle'});
  await waitForWsIdle(marxPage);

  const beforeSendDirect = await lisovRequests.snapshot();
  await sendMessage(lisovPage, `traffic direct ${Date.now()}`);
  await waitForWsIdle(lisovPage);
  expect(await lisovRequests.count('message:create', beforeSendDirect)).toBe(1);
  expect(await lisovRequests.count('message:list', beforeSendDirect)).toBe(0);
  expect(await lisovRequests.count('room:get', beforeSendDirect)).toBe(0);
  expect(await lisovRequests.count('contacts:list', beforeSendDirect)).toBe(0);
  expect(await lisovRequests.count('room:list', beforeSendDirect)).toBe(0);

  const beforeReplyDirect = await marxRequests.snapshot();
  await sendMessage(marxPage, `traffic reply ${Date.now()}`);
  await waitForWsIdle(marxPage);
  expect(await marxRequests.count('message:create', beforeReplyDirect)).toBe(1);
  expect(await marxRequests.count('message:list', beforeReplyDirect)).toBe(0);
  expect(await marxRequests.count('room:get', beforeReplyDirect)).toBe(0);

  const beforeOpenKing = await lisovRequests.snapshot();
  await openRoomByTitle(lisovPage, 'King');
  await waitForWsIdle(lisovPage);
  expect(await lisovRequests.count('message:list', beforeOpenKing)).toBe(1);
  expect(await lisovRequests.count('room:get', beforeOpenKing)).toBe(1);
  expect(await lisovRequests.count('room:list', beforeOpenKing)).toBe(0);
  expect(await lisovRequests.count('contacts:list', beforeOpenKing)).toBe(0);

  const beforeSendGroup = await lisovRequests.snapshot();
  await sendMessage(lisovPage, `traffic group ${Date.now()}`);
  await waitForWsIdle(lisovPage);
  expect(await lisovRequests.count('message:create', beforeSendGroup)).toBe(1);
  expect(await lisovRequests.count('message:list', beforeSendGroup)).toBe(0);
  expect(await lisovRequests.count('room:get', beforeSendGroup)).toBe(0);

  const beforeReturnDefault = await lisovRequests.snapshot();
  await openRoomByTitle(lisovPage, defaultRoomTitle);
  await waitForWsIdle(lisovPage);
  expect(await lisovRequests.count('message:list', beforeReturnDefault)).toBe(0);

  const beforeReturnDirect = await lisovRequests.snapshot();
  await openDirectFromSearch(lisovPage, 'marx');
  await waitForWsIdle(lisovPage);
  expect(await lisovRequests.count('message:list', beforeReturnDirect)).toBe(0);

  const beforeReload = await lisovRequests.snapshot();
  await lisovPage.reload({waitUntil: 'networkidle'});
  await waitForWsIdle(lisovPage);
  await openLeftDrawer(lisovPage);
  expect(await lisovPage.locator('.menu-list .menu-item').count()).toBeGreaterThan(0);
  expect(await lisovRequests.count('user:list', beforeReload)).toBeLessThanOrEqual(1);
  expect(await lisovRequests.count('contacts:list', beforeReload)).toBeLessThanOrEqual(1);
  expect(await lisovRequests.count('room:list', beforeReload)).toBeLessThanOrEqual(3);

  await contextLisov.close();
  await contextMarx.close();
});
