// @ts-check
const { defineConfig, devices } = require('@playwright/test');

/**
 * Playwright configuration for the Chatbot Automation Framework.
 * @see https://playwright.dev/docs/test-configuration
 */
module.exports = defineConfig({
  testDir: './tests',
  // The chatbot talks to a live third-party service, so keep runs serial and
  // give each test generous time to receive bot responses.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // The bot is a streaming AI (replies take many seconds); scenarios repeat the
  // prompt several times, so allow a generous per-test budget.
  timeout: 300_000,
  expect: {
    timeout: 30_000,
  },
  reporter: [
    ['list'],
    ['html', { outputFolder: 'reports/html', open: 'never' }],
    ['json', { outputFile: 'reports/results.json' }],
  ],
  use: {
    baseURL: 'https://www.chatbot.com',
    actionTimeout: 30_000,
    navigationTimeout: 45_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    // LiveChat's widget refuses to mount in headless Chromium (bot detection),
    // so the framework runs headed. In CI, run under a virtual display (xvfb).
    // Override with HEADLESS=true at your own risk.
    headless: process.env.HEADLESS === 'true',
    launchOptions: {
      args: ['--disable-blink-features=AutomationControlled'],
    },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
