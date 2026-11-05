import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/live",
  workers: 1,
  timeout: 90000,
  expect: { timeout: 15000 },
  use: {
    baseURL: "http://127.0.0.1:3100",
    browserName: "chromium",
    viewport: { width: 1366, height: 900 },
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    },
    screenshot: "only-on-failure",
  },
  webServer: [
    {
      command:
        "npm run build && PORT=4300 CORS_ORIGINS=http://127.0.0.1:3100 node dist/src/main.js",
      cwd: "../backend",
      url: "http://127.0.0.1:4300/health/ready",
      reuseExistingServer: false,
      timeout: 60000,
    },
    {
      command:
        "NEXT_PUBLIC_API_URL=http://127.0.0.1:4300 npm run dev -- --hostname 127.0.0.1 --port 3100",
      url: "http://127.0.0.1:3100/login",
      reuseExistingServer: false,
      timeout: 60000,
    },
  ],
});
