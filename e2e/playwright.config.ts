import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests',
  timeout: 30_000,
  reporter: [['json', { outputFile: 'results.json' }], ['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'https://tradies.proappstore.online',
    browserName: 'chromium',
    headless: true,
  },
})
