import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: "http://127.0.0.1:5174",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: [
    {
      command: "node scripts/prepare-playwright-data.mjs && PORT=3100 OH_DATA_DIR=test-results/playwright-data node server/server.js",
      url: "http://127.0.0.1:3100/api/games",
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      command: "OH_API_PROXY_TARGET=http://127.0.0.1:3100 npm run dev -- --host 127.0.0.1 --port 5174 --strictPort",
      url: "http://127.0.0.1:5174",
      reuseExistingServer: false,
      timeout: 30_000,
    },
  ],
});
