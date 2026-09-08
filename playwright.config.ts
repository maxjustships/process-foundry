import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  use: { baseURL: "http://127.0.0.1:5199", trace: "retain-on-failure" },
  webServer: {
    command:
      "npm exec wrangler -- d1 migrations apply bpmn-builder-v0-e2e --local --persist-to .wrangler/state --config tests/fixtures/wrangler.e2e.jsonc && npm run dev -- --host 127.0.0.1 --port 5199",
    env: {
      CLOUDFLARE_VITE_WRANGLER_CONFIG_PATH: "tests/fixtures/wrangler.e2e.jsonc",
    },
    url: "http://127.0.0.1:5199/health",
    reuseExistingServer: false,
    timeout: 120_000,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
