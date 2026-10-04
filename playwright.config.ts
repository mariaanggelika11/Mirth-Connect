import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './client/e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 20000,
  use: {
    baseURL: 'http://127.0.0.1:4173',
    headless: true,
    launchOptions: {
      executablePath:
        process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    },
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'npm run preview -w client -- --host 127.0.0.1 --port 4173',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: false,
  },
  reporter: 'list',
});
