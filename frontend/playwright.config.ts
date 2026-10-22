import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/browser",
  timeout: 60000,
  expect: { timeout: 30000 },
  workers: 1,
  reporter: "list",
  use: {
    baseURL: "http://localhost:3001",
    channel: "chrome",
    headless: true,
    viewport: { width: 1440, height: 1000 },
    launchOptions: { args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] },
    screenshot: "only-on-failure",
  },
  webServer: [
    { command: "..\\backend\\.venv\\Scripts\\python.exe ..\\backend\\tests\\serve_e2e.py", url: "http://localhost:8001/health", reuseExistingServer: false, timeout: 90000 },
    { command: "npm run dev -- --port 3001", url: "http://localhost:3001", reuseExistingServer: false, timeout: 90000, env: { NEXT_PUBLIC_API_BASE_URL: "http://localhost:8001" } },
  ],
});
