import {defineConfig} from '@playwright/test';

const channel = process.env.PW_CHANNEL || 'chromium';
const executablePath = process.env.PW_EXECUTABLE_PATH || undefined;

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
