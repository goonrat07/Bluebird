import { defineConfig } from '@playwright/test';

// PW_CHROMIUM_PATH lets environments with a preinstalled Chromium skip `playwright install`.
const executablePath = process.env.PW_CHROMIUM_PATH || undefined;

export default defineConfig({
  testDir: 'test/e2e',
  timeout: 120_000, // software-rendered CI draws the forest slowly
  // On CI, failures also show up as annotations on the check run, readable without the raw log.
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    baseURL: 'http://localhost:4173',
    viewport: { width: 1280, height: 720 },
    launchOptions: {
      executablePath,
      // Software WebGL so the game renders on machines without a GPU (CI, cloud sessions).
      args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
    },
  },
  webServer: {
    command: 'npm run build && npm run preview',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
