import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright runs against the production build via `pnpm preview`.
 * That's important for catching things like CSP bugs that only appear
 * in production output (Astro's experimental CSP isn't active in dev).
 *
 * In CI we run only Chromium for speed; locally you can extend to
 * webkit + firefox by uncommenting their projects below.
 */
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'html',
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:4321',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        command: 'pnpm preview',
        url: 'http://localhost:4321',
        reuseExistingServer: !process.env.CI,
        timeout: 90 * 1000,
      },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    // Uncomment to run cross-browser locally:
    // { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    // { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
});
