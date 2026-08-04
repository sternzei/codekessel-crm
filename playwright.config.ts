import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 90_000,
  // Specs re-seed the shared database — they must never run in parallel.
  workers: 1,
  use: {
    // Overridable so the suite can be pointed at a dev server that had to take
    // a different port, or at a preview deployment.
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    screenshot: "only-on-failure",
  },
  // The dev flow assumes a running server (`pnpm start` or `pnpm dev`)
  // and freshly seeded data (`pnpm db:seed`).
});
