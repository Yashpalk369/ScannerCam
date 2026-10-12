import { existsSync } from 'node:fs'
import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: false,
  workers: 1,
  timeout: 30000,
  expect: { timeout: 10000 },
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:5173',
    viewport: { width: 390, height: 844 },
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ?? (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined),
    },
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 5173 --strictPort',
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: !process.env.CI,
  },
})
