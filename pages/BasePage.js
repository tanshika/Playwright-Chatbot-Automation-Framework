const logger = require('../utils/logger');

/**
 * BasePage: shared functionality for all page objects.
 *
 * `locateAny`/`frameFor` accept the config's candidate-selector arrays and rely
 * on Playwright's built-in auto-waiting, so page objects tolerate minor markup
 * changes in the third-party chat widget without manual polling.
 */
class BasePage {
  /** @param {import('@playwright/test').Page} page */
  constructor(page) {
    this.page = page;
  }

  async goto(url, options = {}) {
    logger.info(`Navigating to ${url}`);
    await this.page.goto(url, { waitUntil: 'domcontentloaded', ...options });
  }

  /** First element matching any candidate selector, within a Page or FrameLocator. */
  locateAny(context, selectors) {
    return context.locator(selectors.join(', ')).first();
  }

  /** FrameLocator for the first iframe matching any candidate selector. */
  frameFor(selectors) {
    return this.page.frameLocator(selectors.join(', ')).first();
  }
}

module.exports = { BasePage };
