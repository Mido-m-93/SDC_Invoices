import { defineConfig } from "@playwright/test";
import { STORAGE_STATE_PATH } from "./global-setup";

export default defineConfig({
  testDir: ".",
  fullyParallel: false,
  globalSetup: "./global-setup.ts",
  use: {
    baseURL: "http://localhost:3000",
    screenshot: "only-on-failure",
    storageState: STORAGE_STATE_PATH,
  },
});
