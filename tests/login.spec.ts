import {test, expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';

function loadScriptsConfig() {
  const configPath = resolve(process.cwd(), 'scripts', 'config.json');
  const examplePath = resolve(process.cwd(), 'scripts', 'config.example.json');

  try {
    const raw = readFileSync(configPath, 'utf-8');
    return JSON.parse(raw);
  } catch (error: any) {
    if (error?.code === 'ENOENT') {
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
const loginConfig = scriptConfig.e2eLogin || {};

const BASE_URL = String(loginConfig.baseUrl || 'http://127.0.0.1:8815').trim();
const NICKNAME = String(loginConfig.nickname || 'lisov').trim();
const PASSWORD = String(loginConfig.password || '123');

test('login by ws', async ({page}) => {
  await page.goto(`${BASE_URL}/login`, {waitUntil: 'networkidle'});

  await page.getByPlaceholder('nickname').fill(NICKNAME);
  await page.getByPlaceholder('password').fill(PASSWORD);
  await page.getByRole('button', {name: 'Login'}).click();

  await page.waitForURL('**/chat', {timeout: 30000});
  await expect(page.locator('.error')).toHaveCount(0);
});
