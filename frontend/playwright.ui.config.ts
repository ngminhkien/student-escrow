import { defineConfig } from "@playwright/test";
import config from "./playwright.config";

// Browser tests with intercepted API/RPC; never run the SQL/Hardhat integration scenario.
export default defineConfig({ ...config, testIgnore: "**/browser.e2e.ts", timeout: 30000 });
