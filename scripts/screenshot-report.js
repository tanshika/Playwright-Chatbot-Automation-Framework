/**
 * Render the HTML evaluation report to docs/report-screenshot.png for the README.
 *
 *   node scripts/screenshot-report.js
 *
 * reports/ is gitignored, so the scorecard — the framework's main output — is
 * invisible to anyone who has not run the live suite. This keeps a committed
 * image of it that can be refreshed after a run.
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('@playwright/test');

const ROOT = path.join(__dirname, '..');
const reportFile = path.join(ROOT, 'reports', 'evaluation-report.html');
const outFile = path.join(ROOT, 'docs', 'report-screenshot.png');

(async () => {
  if (!fs.existsSync(reportFile)) {
    console.error(`No HTML report found at ${reportFile}. Run "npm test" first.`);
    process.exit(1);
  }

  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 1280, height: 900 },
    deviceScaleFactor: 2, // stays crisp on high-DPI screens
  });
  await page.goto(`file://${reportFile}`);

  // Clip just above the second suite so the image always ends on a card
  // boundary. A fixed height would slice a validator table in half as soon as
  // the cases change. Falls back to the whole page if there is only one suite.
  const cut = await page.evaluate(() => {
    const suites = [...document.querySelectorAll('.suite')];
    if (suites.length < 2) return null;
    return Math.round(suites[1].getBoundingClientRect().top + window.scrollY) - 14;
  });

  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  await page.screenshot({
    path: outFile,
    // fullPage is required for a clip taller than the viewport; without it the
    // image is silently truncated at the viewport height.
    fullPage: true,
    ...(cut ? { clip: { x: 0, y: 0, width: 1280, height: cut } } : {}),
  });
  await browser.close();

  console.log(`Screenshot written to ${outFile}`);
})();
