import { defineConfig } from '@playwright/test';

const CI = !!process.env['CI'];

const CONSOLE_URL = process.env['CONSOLE_BASE_URL'] ?? 'http://localhost:5174';

export default defineConfig({
  testDir: './src',
  testMatch: '**/*.e2e.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  expect: {
    timeout: 20_000,
  },
  retries: CI ? 1 : 0,
  reporter: CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  globalSetup: './src/global-setup.ts',
  use: {
    baseURL: CONSOLE_URL,
    trace: 'retain-on-failure',
  },
});
