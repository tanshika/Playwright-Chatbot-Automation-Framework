const { BasePage } = require('./BasePage');
const config = require('../config/framework.config');
const logger = require('../utils/logger');

/**
 * Raised when the chat widget cannot be reached on the target site (launcher
 * absent or input never mounts) — i.e. an external outage/throttling, not a bug
 * in the automation. Specs use this to skip cleanly instead of hard-failing.
 */
class WidgetUnavailableError extends Error {
  constructor(message) {
    super(message);
    this.name = 'WidgetUnavailableError';
  }
}

/** Normalize text for equality checks (lowercase, alphanumeric words only). */
function norm(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/**
 * DOM scan executed *inside* the widget iframe.
 *
 * LiveChat uses hashed class names and streams replies, so messages are read
 * structurally: each bubble is the tightest text wrapper, de-duplicated by
 * vertical position, with noise (receipts, typing indicator, footer, and
 * multi-message concatenation containers) filtered out. Bubble side is decided
 * by horizontal position — visitor messages are right-aligned, bot left.
 *
 * Returns ordered [{ text, side: 'bot' | 'visitor' }]. Must be self-contained
 * (serialized into the page), so options are passed in as an argument.
 */
function extractMessagesInFrame(_el, opts) {
  const { visitorSideRatio, maxBubbleChars } = opts;
  const vw = window.innerWidth;
  // Widget chrome to ignore: receipts, typing indicator, footer, consent line.
  //
  // Every pattern MUST be anchored (^...$) so it describes a whole bubble. These
  // were once substring matches, which silently ate real answers: the bot's
  // reply to the PII probe ends "...please review our Privacy Policy", so the
  // /privacy policy/ pattern discarded the entire reply bubble mid-stream. The
  // extracted reply then went empty, and because askAndMeasure only settles on a
  // NON-empty reply, the poll loop span all the way to its 60s deadline and
  // returned the text truncated at the moment the phrase appeared.
  const NOISE = [
    /^.{0,40}\bis typing\b.{0,3}$/i,
    /^powered by\b.*$/i,
    /^text\.com$/i,
    /^read$/i,
    /^delivered$/i,
    /^\d{1,2}:\d{2}(\s*[ap]\.?m\.?)?$/i,
    /^ai assistant$/i,
    /^text support( ai assistant)?$/i,
    /^privacy policy$/i,
    /^by chatting here\b.*$/i,
  ];

  const isBlock = (e) => {
    const d = getComputedStyle(e).display;
    return d && d !== 'inline' && d !== 'none' && d !== 'contents';
  };
  const textOf = (e) => (e.innerText || '').trim();

  // Text belonging to THIS element rather than to its block children: direct
  // text nodes plus inline descendants.
  const directTextOf = (e) => {
    let s = '';
    for (const n of e.childNodes) {
      if (n.nodeType === 3) s += n.textContent;
      else if (n.nodeType === 1 && !isBlock(n)) s += n.innerText || n.textContent || '';
    }
    return s.trim();
  };

  // A message bubble is block-level with text. Blocks whose text comes entirely
  // from block children are wrappers and contribute nothing themselves, which
  // keeps multi-message containers from being double-counted.
  const byText = new Map();
  for (const e of document.querySelectorAll('div,li,p,section,article')) {
    const full = textOf(e);
    if (!full) continue;
    if (!isBlock(e)) continue;

    const hasBlockTextChild = [...e.querySelectorAll('div,li,p,section,article')].some(
      (c) => isBlock(c) && textOf(c),
    );

    // A block can be BOTH bubble and wrapper. When the bot renders a nested
    // list, each <li> carries its own text ("Essential Plan: $19 per user/month")
    // alongside a block child holding the details. Skipping every element with a
    // block child discarded that own text: the plan names vanished from replies
    // while the orphaned detail lines survived. Take the element's own text in
    // that case — a pure wrapper's own text is empty, so it is still skipped.
    const t = hasBlockTextChild ? directTextOf(e) : full;
    if (!t || t.length > maxBubbleChars) continue;

    const flat = t.replace(/\s+/g, ' ').trim();
    if (NOISE.some((re) => re.test(flat))) continue;
    const r = e.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if (byText.has(t)) continue;
    const centerX = r.left + r.width / 2;
    byText.set(t, { text: t, side: centerX > vw * visitorSideRatio ? 'visitor' : 'bot', top: Math.round(r.top) });
  }

  return [...byText.values()].sort((a, b) => a.top - b.top).map(({ text, side }) => ({ text, side }));
}

/**
 * Page object for the chat widget under test (LiveChat AI assistant).
 *
 * Tests/validators interact with the bot only through `open()` and
 * `askAndMeasure()`; all selector and DOM detail is contained here.
 */
class ChatBotPage extends BasePage {
  constructor(page) {
    super(page);
    this.cfg = config;
    /** @type {import('@playwright/test').FrameLocator | null} */
    this.frame = null;
  }

  /** Load the sample page and open the conversation. */
  async open() {
    await this.goto(this.cfg.samplePageUrl);
    this.frame = this.frameFor(this.cfg.frames.maximized);

    const launcher = this.locateAny(
      this.frameFor(this.cfg.frames.minimized),
      this.cfg.selectors.launcherButton,
    );
    const input = this.locateAny(this.frame, this.cfg.selectors.messageInput);

    // If the launcher never appears, the widget is unavailable on the target
    // site (throttling / availability rules) — not an automation bug.
    try {
      await launcher.waitFor({ state: 'visible', timeout: this.cfg.timing.widgetAvailabilityTimeoutMs });
    } catch {
      throw new WidgetUnavailableError(
        'Chat widget launcher never appeared on the target site — the widget looks unavailable ' +
          '(possible LiveChat throttling or availability/targeting rules).',
      );
    }

    // The widget is timing-sensitive; click until the input actually mounts.
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await launcher.click({ timeout: 5_000 }).catch(() => {});
      try {
        await input.waitFor({ state: 'visible', timeout: 8_000 });
        logger.info('Chat widget is open and ready.');
        return;
      } catch {
        logger.debug(`Widget not open yet (attempt ${attempt + 1}); retrying.`);
      }
    }
    throw new WidgetUnavailableError(
      'Chat widget did not open — the message input never mounted (widget may be throttled or unavailable).',
    );
  }

  /** Type a message into the widget input and submit it. */
  async sendMessage(text) {
    const input = this.locateAny(this.frame, this.cfg.selectors.messageInput);
    await input.click();
    await input.fill(text);
    await input.press('Enter');
    logger.info(`Sent message: "${text}"`);
  }

  /** Read all message bubbles currently rendered, classified by author side. */
  async readMessages() {
    return this.frame
      .locator('body')
      .evaluate(extractMessagesInFrame, {
        visitorSideRatio: this.cfg.reading.visitorSideRatio,
        maxBubbleChars: this.cfg.reading.maxBubbleChars,
      });
  }

  /**
   * The bot's reply to `sentText`: the clean left-side bubbles that appear after
   * the visitor's echoed message. Robust to repeated/identical answers.
   */
  static replyAfterEcho(messages, sentText) {
    let echoIdx = -1;
    for (let i = 0; i < messages.length; i += 1) {
      if (messages[i].side === 'visitor' && norm(messages[i].text) === norm(sentText)) echoIdx = i;
    }
    // No echo yet => the reply hasn't started; return empty so the caller waits
    // (avoids mistaking the pre-existing welcome message for the answer).
    if (echoIdx < 0) return '';
    return messages
      .slice(echoIdx + 1)
      .filter((m) => m.side === 'bot')
      .map((m) => m.text)
      .join(' ')
      .trim();
  }

  /**
   * Send a message, wait for the complete (settled) bot reply, and measure latency.
   *
   * `settled` reports whether the reply actually stopped changing. A false value
   * means the text may be incomplete and `latencyMs` is not a completion time —
   * callers should treat both as suspect rather than as a measurement.
   *
   * @returns {Promise<{ response: string, latencyMs: number, settled: boolean }>}
   */
  async askAndMeasure(text) {
    const sentAt = Date.now();
    await this.sendMessage(text);

    const { botReplyTimeoutMs, botReplyQuietPeriodMs, pollIntervalMs } = this.cfg.timing;
    const deadline = sentAt + botReplyTimeoutMs;
    let lastReply = '';
    let lastChangeAt = Date.now();
    let vanishedAt = null;
    let settled = false;

    while (Date.now() < deadline) {
      const reply = ChatBotPage.replyAfterEcho(await this.readMessages(), text);

      if (reply) {
        vanishedAt = null;
        if (reply !== lastReply) {
          lastReply = reply; // still streaming
          lastChangeAt = Date.now();
        } else if (Date.now() - lastChangeAt >= botReplyQuietPeriodMs) {
          settled = true;
          break;
        }
      } else if (lastReply) {
        // The reply had content and then read back empty — a re-render, or a
        // bubble the extractor stopped recognising. Tolerate a brief blip, but
        // never wait out the whole timeout: this state used to satisfy neither
        // branch above, so the loop span to the deadline and returned text
        // truncated at the moment of disappearance as if it were complete.
        if (vanishedAt == null) vanishedAt = Date.now();
        else if (Date.now() - vanishedAt >= botReplyQuietPeriodMs) break;
      }

      await this.page.waitForTimeout(pollIntervalMs);
    }

    if (!lastReply) {
      throw new Error(`No bot reply received within ${botReplyTimeoutMs}ms for: "${text}"`);
    }
    const latencyMs = Date.now() - sentAt;
    if (settled) {
      logger.info(`Bot replied in ${latencyMs}ms.`);
    } else {
      logger.warn(
        `Reply never settled for "${text}" — text may be truncated and ${latencyMs}ms is not a completion time.`,
      );
    }
    return { response: lastReply, latencyMs, settled };
  }
}

// extractMessagesInFrame is exported so its DOM rules can be exercised against
// synthetic markup, without depending on how the live bot happens to render.
module.exports = { ChatBotPage, WidgetUnavailableError, extractMessagesInFrame };
