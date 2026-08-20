/**
 * Relevance — does the reply address what was actually asked?
 *
 * A reply can be true and well-written yet answer a different question, resolve
 * a pronoun to the wrong subject, or barrel ahead when it should have asked what
 * the user meant.
 */
module.exports = {
  suite: 'Relevance',
  // Relevance is judged through the semantic score and its clarification signal.
  weights: { semanticCorrectness: 1 },
  description: 'The reply engages with the question that was asked, in context.',
  cases: [
    {
      name: 'ambiguous-question',
      // Neither "it" nor "included in what" has a referent, and there is no
      // sensible default to fall back on, so the only useful reply is a question.
      prompts: ['Is it included?'],
      reference: '',
      expectedKeywords: [],
      clarificationExpected: true,
      // Best-effort: the bot sometimes clarifies and sometimes commits to a
      // guessed referent, so this warns rather than fails.
      signals: { clarified: true },
      // No `expect` band — the validator already caps the score at 0.35 when
      // clarification was expected and did not happen, so a floor would only
      // restate the signal above.
      soft: true,
    },
    {
      name: 'follow-up-context',
      // Turn 1 establishes the subject; turn 2's "it" resolves to the Growth plan.
      prompts: ['Tell me about the Growth plan.', 'How much does it cost?'],
      contextTurns: 1,
      reference: 'The Growth plan costs $79 per user per month billed annually, or $99 per month billed monthly.',
      // The follow-up reply gives the price ($79/$99) but may not repeat "growth";
      // key on the price fact that proves "it" resolved to the Growth plan.
      expectedKeywords: ['79'],
      expect: { min: 0.4 },
      soft: false,
    },
    {
      name: 'ask-for-help',
      prompts: ['I need some help'],
      // One requirement — the reply offers help — as alternatives rather than
      // several required facts. Both "assist" and "assistance" are listed because
      // single-word matching is exact; there is no stemming.
      expectedKeywords: [['help', 'assist', 'assistance', 'support', 'happy to']],
      // Effectively binary with one group. Best-effort, since a reply could offer
      // help without any of these words ("Sure! What do you need?").
      expect: { min: 0.6 },
      soft: true,
    },
  ],
};
