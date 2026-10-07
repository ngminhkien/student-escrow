import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests", testMatch: "**/*.e2e.ts", workers: 1, timeout: 240000,
  expect: { timeout: 20000 }, reporter: "list",
  use: { baseURL: "http://127.0.0.1:5174", channel: process.env.PLAYWRIGHT_CHANNEL ?? "chrome", headless: true, actionTimeout: 15000,
    screenshot: "only-on-failure", trace: "retain-on-failure" },
  globalSetup: "./tests/setup.ts"
});
