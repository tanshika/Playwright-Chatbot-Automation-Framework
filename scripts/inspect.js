const { chromium } = require('@playwright/test');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto('https://www.chatbot.com/help/chat-widget/sample-page/', {
    waitUntil: 'domcontentloaded',
  });
  await page.waitForTimeout(7000);
  await page.screenshot({ path: 'scripts/before.png' });

  // Click the launcher bubble inside the minimized iframe.
  const btn = page.frameLocator('#chat-widget-minimized').locator('button').first();
  await btn.click({ force: true, timeout: 8000 });
  console.log('Clicked launcher; waiting for maximized widget to mount...');

  // Wait until the maximized frame actually renders an input.
  const maximized = page.frameLocator('#chat-widget');
  const input = maximized.locator('textarea, [contenteditable="true"], [role="textbox"]').first();
  try {
    await input.waitFor({ state: 'visible', timeout: 20000 });
    console.log('Input is visible!');
  } catch (e) {
    console.log('Input did not appear:', e.message.split('\n')[0]);
  }
  await page.waitForTimeout(2000);
  await page.screenshot({ path: 'scripts/after.png' });

  for (const f of page.frames()) {
    if (!f.url().includes('livechat')) continue;
    try {
      const info = await f.evaluate(() => {
        const desc = (e) => ({
          tag: e.tagName, id: e.id, testid: e.getAttribute('data-testid'),
          role: e.getAttribute('role'), aria: e.getAttribute('aria-label'),
          placeholder: e.getAttribute('placeholder'), cls: (e.className || '').toString().slice(0, 70),
        });
        const q = (s) => Array.from(document.querySelectorAll(s));
        return {
          totalEls: document.querySelectorAll('*').length,
          typeable: q('textarea,input,[contenteditable="true"],[role="textbox"]').map(desc),
          testids: [...new Set(q('[data-testid]').map((e) => e.getAttribute('data-testid')))].slice(0, 40),
          sendBtns: q('button').map(desc).filter((b) =>
            `${b.aria} ${b.cls} ${b.testid}`.toLowerCase().includes('send')),
        };
      });
      console.log(`\n=== frame ${f.name()} ===`);
      console.log(JSON.stringify(info, null, 2));
    } catch (e) {
      console.log(`frame ${f.name()} evaluate failed: ${e.message.split('\n')[0]}`);
    }
  }

  await browser.close();
})();
