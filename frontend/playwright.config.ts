import { defineConfig } from '@playwright/test'
export default defineConfig({
  testDir: './scripts/agent-api', testMatch: '**/*.spec.mjs', fullyParallel: false, workers: 1,
  timeout: 60_000, reporter: [['list']],
  use: { baseURL: 'http://127.0.0.1:5173', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  webServer: { command: 'node scripts/agent-api/dev.mjs', url: 'http://127.0.0.1:5173/settings/api-keys', reuseExistingServer: false, timeout: 60_000 },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
})
