import { getViteConfig } from 'astro/config';
import react from '@vitejs/plugin-react';

/**
 * Vitest config — uses Astro's getViteConfig() helper so our path aliases
 * (~/ for src/), TS settings, and Vite plugins are shared with the build.
 *
 * Layout:
 *  - tests/unit         pure logic (format, fileTypes…)
 *  - tests/components   React component tests via @testing-library/react
 *  - tests/e2e          Playwright tests (NOT picked up here — see playwright.config.ts)
 */
export default getViteConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    globals: true,
    include: ['tests/unit/**/*.test.{ts,tsx}', 'tests/components/**/*.test.{ts,tsx}'],
    css: true,
  },
});
