import {defineConfig} from '@playwright/test';
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
const playwrightConfig = scriptConfig.playwright || {};

const channel = String(playwrightConfig.channel || 'chromium').trim() || 'chromium';
const executablePathRaw = String(playwrightConfig.executablePath || '').trim();
const executablePath = executablePathRaw || undefined;

export default defineConfig({
  testDir: './tests',
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  fullyParallel: false,
  workers: 1,
  projects: [
    {
      name: 'chromium',
      use: {
        browserName: 'chromium',
        ...(executablePath ? {executablePath} : {channel}),
        headless: true,
        launchOptions: {
          args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-crash-reporter',
            '--disable-breakpad',
            '--disable-crashpad',
          ],
        },
      },
    },
  ],
});
