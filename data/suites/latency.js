/**
 * Latency / Performance — how long does the bot take to finish answering?
 *
 * Measured end to end: from sending the message until the reply stops changing
 * (see ChatBotPage.askAndMeasure), so it includes the streaming tail, not just
 * time-to-first-token.
 *
 * The bot is a streaming AI assistant on a public demo site, so measurements are
 * noisy by nature — observed 10-20s. The ceiling below is a regression guard,
 * not an SLA, and is best-effort so a slow afternoon doesn't fail the run.
 */
module.exports = {
  suite: 'Latency / Performance',
  // Response time dominates; the semantic score only confirms the bot said
  // something sensible at all.
  weights: { latency: 0.75, semanticCorrectness: 0.25 },
  description: 'The bot finishes answering within an acceptable time budget.',
  cases: [
    {
      name: 'greeting-response-time',
      // The cheapest possible turn: no lookup, no reasoning. If even this is
      // slow, the widget or the service is degraded rather than the question
      // being hard. Carried over from the old `greeting` scenario.
      prompts: ['Hello'],
      // ONE requirement — the reply greets back — expressed as alternatives. As a
      // flat list this demanded "hi" AND "hello" AND "help" in the same sentence,
      // which no greeting says: "Hello and welcome! How can we assist you today?"
      // scored 0.667 for the crime of not also saying "hi".
      expectedKeywords: [['hi', 'hello', 'hey', 'welcome', 'greetings', 'help', 'assist']],
      latency: { maxMs: 30_000 },
      // Wording of a greeting is not what this suite is about; the floor exists
      // only so an empty or nonsense reply still shows up.
      expect: { min: 0.6 },
      soft: true,
    },
  ],
};
