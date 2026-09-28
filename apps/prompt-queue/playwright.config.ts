import { defineConfig } from '@playwright/test';

// Launches the built Electron app (`pnpm build` first). On Linux without a
// display, run under Xvfb: `xvfb-run -a pnpm test:e2e`.
export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    trace: 'retain-on-failure',
  },
});
