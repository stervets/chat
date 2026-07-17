import {expect, test, type Page} from '@playwright/test';

const {
  CONFIG,
  WsRpcClient,
  assertNoApiError,
  loginByPassword,
} = require('./helpers/e2e');

const BASE_URL = 'http://127.0.0.1:8815';

async function login(page: Page, nickname: string, password: string) {
  await page.goto(`${BASE_URL}/login`, {waitUntil: 'networkidle'});
  await page.getByPlaceholder('nickname').fill(nickname);
  await page.getByPlaceholder('password').fill(password);
  await page.getByRole('button', {name: 'Login'}).click();
  await page.waitForURL('**/chat**', {timeout: 30_000});
}

async function openDrawerSection(page: Page, section: 'Директы' | 'Комнаты') {
  const drawer = page.locator('.drawer-left');
  if (!await drawer.evaluate((node) => node.classList.contains('open')).catch(() => false)) {
    await page.locator('.menu-toggle-btn').click();
  }
  await expect(drawer).toHaveClass(/open/);
  expect(await drawer.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
  await page.getByRole('button', {name: section}).click();
}

async function openDirect(page: Page, nickname: string) {
  await openDrawerSection(page, 'Директы');
  await page.getByPlaceholder('Найти директ или пользователя...').fill(nickname);
  await page.locator('.users-list .menu-item').filter({hasText: new RegExp(nickname, 'i')}).first().click();
  await expect(page.locator('.drawer-left')).not.toHaveClass(/open/);
}

async function openRoom(page: Page, title: string) {
  await openDrawerSection(page, 'Комнаты');
  await page.getByPlaceholder('Найти комнату...').fill(title);
  await page.locator('.menu-list .menu-item').filter({hasText: title}).first().click();
  await expect(page.locator('.drawer-left')).not.toHaveClass(/open/);
}

test('reaction notification clears when its message becomes visible', async ({browser}) => {
  const lisovClient = new WsRpcClient(CONFIG.backendWsUrl);
  const marxClient = new WsRpcClient(CONFIG.backendWsUrl);
  const createdMessageIds: number[] = [];
  let context = null;

  try {
    await Promise.all([lisovClient.connect(), marxClient.connect()]);
    await Promise.all([
      loginByPassword(lisovClient, 'lisov', '123'),
      loginByPassword(marxClient, 'marx', '123'),
    ]);

    const marxUser = assertNoApiError(
      await lisovClient.request('user:get', {nickname: 'marx'}),
      'user:get marx',
    );
    const direct = assertNoApiError(
      await lisovClient.request('room:direct:get-or-create', {userId: Number(marxUser.user?.id || 0)}),
      'room:direct:get-or-create marx',
    );
    const directRoomId = Number(direct.roomId || 0);
    expect(directRoomId).toBeGreaterThan(0);

    const marker = `reaction-visible-${Date.now()}`;
    const target = assertNoApiError(
      await lisovClient.request('message:create', {roomId: directRoomId, text: marker}),
      'message:create target',
    );
    const targetMessageId = Number(target.message?.id || 0);
    expect(targetMessageId).toBeGreaterThan(0);
    createdMessageIds.push(targetMessageId);

    for (let index = 0; index < 14; index += 1) {
      const filler = assertNoApiError(
        await lisovClient.request('message:create', {
          roomId: directRoomId,
          text: `${marker}-filler-${index} ${'x'.repeat(90)}`,
        }),
        `message:create filler ${index}`,
      );
      createdMessageIds.push(Number(filler.message?.id || 0));
    }

    context = await browser.newContext({viewport: {width: 390, height: 844}});
    const page = await context.newPage();
    await login(page, 'lisov', '123');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await openDirect(page, 'marx');
    await expect(page.locator(`[data-message-id="${targetMessageId}"]`)).toHaveCount(1);

    await openRoom(page, 'Общий чат');
    assertNoApiError(
      await marxClient.request('message:reaction:set', {messageId: targetMessageId, emoji: '🔥'}),
      'message:reaction:set',
    );

    await expect(page.locator('.notify-badge')).toHaveText('1');
    await page.locator('.notify-btn').click();
    await expect(page.locator('.notification-item')).toContainText(marker);
    await page.locator('.notify-btn').click();

    await openDirect(page, 'marx');
    await expect(page.locator('.notify-badge')).toHaveText('1');

    const targetMessage = page.locator(`[data-message-id="${targetMessageId}"]`);
    const initiallyVisible = await targetMessage.evaluate((node) => {
      const viewport = node.closest('.chat-body');
      if (!viewport) return false;
      const viewportRect = viewport.getBoundingClientRect();
      const messageRect = node.getBoundingClientRect();
      return messageRect.bottom > viewportRect.top && messageRect.top < viewportRect.bottom;
    });
    expect(initiallyVisible).toBe(false);

    await targetMessage.scrollIntoViewIfNeeded();
    await expect(page.locator('.notify-badge')).toHaveCount(0);
    await page.locator('.notify-btn').click();
    await expect(page.locator('.notifications-menu')).toContainText('Пока пусто');
  } finally {
    if (context) await context.close();
    for (const messageId of createdMessageIds.reverse()) {
      await lisovClient.request('message:delete', {messageId}).catch(() => null);
    }
    await Promise.all([lisovClient.close(), marxClient.close()]);
  }
});
