import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/pwa',
  outputDir: './test-results/pwa',
  workers: 1,
  reporter: 'list',
  timeout: 45000,
  use: {
    ...devices['Desktop Chrome'],
    channel: 'msedge',
    baseURL: 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: `${process.platform === 'win32' ? 'npm.cmd' : 'npm'} run preview -- --host 127.0.0.1 --port 4173`,
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: true,
    timeout: 30000,
  },
});
