import { defineConfig } from '@playwright/test';

/**
 * End-to-end tests that drive the actual demo app in a real Chromium
 * browser and inspect the resulting PDF bytes. These exist because the
 * core claim of this library -- real, selectable PDF text produced from a
 * live DOM layout -- can only be verified against a real browser's
 * getBoundingClientRect/getComputedStyle/Range behavior; jsdom-based unit
 * tests (see projects/ngx-pdf-export/src/lib/**\/*.spec.ts) cover the pure
 * algorithmic pieces (pagination, unit conversion, SVG path scaling) but
 * cannot exercise DOM inspection itself.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  webServer: {
    command: 'npx ng serve demo --port 4300',
    url: 'http://localhost:4300',
    reuseExistingServer: true,
    timeout: 60_000,
  },
  use: {
    baseURL: 'http://localhost:4300',
  },
});
