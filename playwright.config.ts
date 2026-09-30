import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  use: { baseURL: "http://127.0.0.1:4185" },
  webServer: {
    command: "npm run start:e2e",
    url: "http://127.0.0.1:4185/api/health",
    reuseExistingServer: false,
  },
});
