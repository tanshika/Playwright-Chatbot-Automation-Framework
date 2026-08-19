/**
 * Central configuration for the framework.
 *
 * Selectors/thresholds are kept here (not scattered across page objects) so
 * that when the third-party widget markup changes, there is a single place to
 * update. Selectors are stored as candidate lists tried in order, which makes
 * the automation resilient to minor DOM/attribute changes.
 *
 * The target widget is a LiveChat AI-assistant widget embedded on chatbot.com's
 * sample page. Verified against the live site (see scripts/inspect*.js).
 */
module.exports = {
  // The page that embeds the chat widget under test.
  samplePageUrl: 'https://www.chatbot.com/help/chat-widget/sample-page/',

  // The chat widget renders inside iframes: a minimized (bubble) frame and a
  // maximized (open conversation) frame.
  frames: {
    minimized: ['iframe#chat-widget-minimized'],
    maximized: ['iframe#chat-widget'],
  },

  // Selectors resolved *inside* the widget iframe.
  selectors: {
    // The minimized frame contains a single toggle button (the launcher bubble).
    launcherButton: ['button', '[role="button"]'],
    messageInput: [
      'textarea[placeholder*="Write a message" i]',
      'textarea[aria-label*="Write a message" i]',
      'textarea[placeholder*="message" i]',
      'textarea',
    ],
    sendButton: [
      'button[aria-label*="Send a message" i]',
      'button[aria-label*="send" i]',
    ],
  },

  // How bot replies are read from the streamed, hashed-class LiveChat DOM.
  // Bot messages are left-aligned, visitor messages right-aligned; the reply is
  // the clean left-side bubbles that appear after the visitor's echoed message.
  reading: {
    // Fraction of widget width past which a bubble is considered visitor (right).
    visitorSideRatio: 0.55,
    // Sanity cap on a single bubble's length. Real answers can be long, so this
    // is generous; concatenation containers are excluded structurally (leaf
    // block-level detection), not by length.
    maxBubbleChars: 4000,
  },

  timing: {
    // Max time to wait for a bot reply after sending (the AI streams slowly).
    botReplyTimeoutMs: 60_000,
    // Consider the reply "done" once its text is unchanged for this quiet period.
    botReplyQuietPeriodMs: 3_000,
    pollIntervalMs: 400,
    // Time budget to open/mount the widget.
    widgetOpenTimeoutMs: 40_000,
    // How long to wait for the launcher before deeming the widget unavailable
    // (shorter than open, so outages fail fast and skip instead of hanging).
    widgetAvailabilityTimeoutMs: 20_000,
    // Delay between sessions to avoid tripping LiveChat's abuse throttling.
    interSessionDelayMs: 4_000,
  },

  // Weights used by the EvaluationEngine to combine individual validator scores
  // into a single overall score. Normalized automatically (need not sum to 1).
  weights: {
    semanticCorrectness: 0.35,
    sensitiveInfo: 0.25,
    consistency: 0.2,
    latency: 0.2,
  },

  // Score (0..1) at or above which the overall evaluation is considered a pass.
  passThreshold: 0.6,

  latency: {
    // Response times mapped onto a 0..1 score by linear interpolation.
    // Tuned for a streaming AI assistant (full completion takes many seconds).
    //  <= goodMs => 1.0 ,  >= badMs => 0.0
    goodMs: 6_000,
    badMs: 35_000,
  },
};
