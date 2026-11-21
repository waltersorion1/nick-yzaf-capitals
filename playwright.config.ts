import "dotenv/config";
import { defineConfig, devices } from "@playwright/test";
if (
  !process.env.TEST_DATABASE_URL ||
  process.env.TEST_DATABASE_URL === process.env.DATABASE_URL
)
  throw new Error(
    "Use a dedicated migrated TEST_DATABASE_URL distinct from DATABASE_URL",
  );
export default defineConfig({
  testDir: "tests/e2e",
  globalSetup: "./tests/e2e/setup.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 45000,
  use: {
    baseURL: "http://localhost:3103",
    colorScheme: "dark",
    serviceWorkers: "allow",
    screenshot: "only-on-failure",
    trace: "off",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    command: "npx tsx tests/e2e/server.ts",
    url: "http://localhost:3103",
    reuseExistingServer: false,
    timeout: 30000,
    env: {
      ...process.env,
      DATABASE_URL: process.env.TEST_DATABASE_URL,
      SESSION_SECRET: "e2e-only-random-fixture-secret-32-characters",
      APP_ORIGIN: "http://localhost:3103",
      PORT: "3103",
      NODE_ENV: "test",
    },
  },
});
