import {test, expect} from '@playwright/test';

const BASE_URL = process.env.E2E_BASE_URL || 'http://127.0.0.1:8815';
const NICKNAME = process.env.E2E_NICKNAME || 'lisov';
const PASSWORD = process.env.E2E_PASSWORD || '123';

test('login by ws', async ({page}) => {
  await page.goto(`${BASE_URL}/login`, {waitUntil: 'networkidle'});

  await page.getByPlaceholder('nickname').fill(NICKNAME);
  await page.getByPlaceholder('password').fill(PASSWORD);
  await page.getByRole('button', {name: 'Login'}).click();

  await page.waitForURL('**/chat', {timeout: 30000});
  await expect(page.locator('.error')).toHaveCount(0);
});
