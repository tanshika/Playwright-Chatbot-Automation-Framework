const { test, expect } = require('@playwright/test');
const { extractMessagesInFrame } = require('../pages/ChatBotPage');
const config = require('../config/framework.config');

/**
 * Deterministic guards for the widget's DOM reading rules.
 *
 * These run against synthetic markup instead of the live bot: no network, no
 * throttling, ~1s. Each case guards against a way the reader has silently lost
 * message content — the failure mode is not an exception but a reply that looks
 * plausible while missing part of what the bot said.
 */

const OPTS = {
  visitorSideRatio: config.reading.visitorSideRatio,
  maxBubbleChars: config.reading.maxBubbleChars,
};

async function extract(page, html) {
  await page.setContent(`<body style="margin:0">${html}</body>`);
  return page.locator('body').evaluate(extractMessagesInFrame, OPTS);
}

const joined = (msgs) => msgs.map((m) => m.text).join(' | ');

test.describe('message extraction', () => {
  // Each <li> carries its own text alongside a block child holding the detail.
  // Skipping every element with a block child drops that own text, leaving the
  // orphaned detail lines without the plan names they belong to.
  test('a block that is both bubble and wrapper keeps its own text', async ({ page }) => {
    const msgs = await extract(page, `
      <div class="log" style="width:900px">
        <div class="msg">
          Absolutely! Here are our current pricing plans:
          <ul>
            <li>Essential Plan: $19 per user/month (billed annually).
              <div>Includes: AI chatbot, live chat, shared inbox.</div>
            </li>
            <li>Growth Plan: $79 per user/month (billed annually).
              <div>Adds: 200 AI Agent resolutions, unlimited chat history.</div>
            </li>
            <li>Enterprise Plan: Custom pricing.
              <div>Includes everything in Growth, plus custom AI Agents.</div>
            </li>
          </ul>
        </div>
      </div>`);

    const all = joined(msgs);
    for (const name of ['Essential', 'Growth', 'Enterprise']) expect(all).toContain(name);
    expect(all).toContain('$19');
    expect(all).toContain('Includes: AI chatbot'); // detail text still present
    expect(all).toContain('Here are our current pricing'); // intro text too
  });

  test('flat list rendering is unaffected', async ({ page }) => {
    const msgs = await extract(page, `
      <div class="log" style="width:900px">
        <div class="msg">
          <ul>
            <li>Essential Plan: $19 per user/month (billed annually).</li>
            <li>Growth Plan: $79 per user/month (billed annually).</li>
            <li>Enterprise Plan: Custom pricing.</li>
          </ul>
        </div>
      </div>`);

    const all = joined(msgs);
    for (const name of ['Essential', 'Growth', 'Enterprise']) expect(all).toContain(name);
  });

  // A wrapper whose text comes entirely from block children must contribute
  // nothing itself, or both messages get counted twice as one combined bubble.
  test('a pure wrapper is not emitted as a bubble', async ({ page }) => {
    const msgs = await extract(page, `
      <div class="log" style="width:900px">
        <div class="group">
          <div>First bot message.</div>
          <div>Second bot message.</div>
        </div>
      </div>`);

    const texts = msgs.map((m) => m.text);
    expect(texts).toContain('First bot message.');
    expect(texts).toContain('Second bot message.');
    expect(texts.some((t) => t.includes('First') && t.includes('Second'))).toBe(false);
  });

  // As substring matches, the noise patterns discard any real answer that
  // mentions the privacy policy; the extracted reply then goes empty and
  // askAndMeasure runs to its timeout with truncated text.
  test('chrome is filtered without swallowing replies that mention it', async ({ page }) => {
    const msgs = await extract(page, `
      <div class="log" style="width:900px">
        <div>We cannot share customer data. For details, please review our Privacy Policy.</div>
        <div>Privacy Policy</div>
        <div>By chatting here, you agree to our Privacy Policy</div>
        <div>AI Assistant is typing…</div>
        <div>12:30 PM</div>
        <div>Powered by LiveChat</div>
        <div>Delivered</div>
      </div>`);

    const texts = msgs.map((m) => m.text);
    expect(texts).toContain('We cannot share customer data. For details, please review our Privacy Policy.');
    for (const chrome of [
      'Privacy Policy',
      'By chatting here, you agree to our Privacy Policy',
      'AI Assistant is typing…',
      '12:30 PM',
      'Powered by LiveChat',
      'Delivered',
    ]) {
      expect(texts).not.toContain(chrome);
    }
  });
});
