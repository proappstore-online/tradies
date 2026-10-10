import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests',
  timeout: 30_000,
  reporter: [['json', { outputFile: 'results.json' }], ['list']],
  // Local mocked acceptance tests run against the Vite app.  The release smoke
  // project deliberately retains the live, signed-out URL below.
  webServer: {
    command: 'pnpm --dir ../web exec vite --host 127.0.0.1 --port 4187',
    url: 'http://127.0.0.1:4187',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
  projects: [
    {
      name: 'local-mocked-ui',
      testMatch: 'local-mocked-ui.spec.ts',
      use: { baseURL: 'http://127.0.0.1:4187', browserName: 'chromium', headless: true },
    },
    {
      name: 'live-signed-out-smoke',
      testMatch: 'public-release.spec.ts',
      use: {
        baseURL: process.env.E2E_BASE_URL ?? 'https://tradies.proappstore.online',
        browserName: 'chromium',
        headless: true,
      },
    },
  ],
})
