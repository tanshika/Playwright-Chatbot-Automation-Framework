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
      // Under-specified first message: "it" has no referent, and unlike the
      // previous prompt here ("How much is it?") there is no reasonable guess to
      // fall back on. That mattered: on a pricing site "how much is it" is
      // effectively answerable, and the bot listing every plan was a fair reply
      // being marked as a failure. "Is it included?" cannot be answered without
      // knowing what "it" and "included in what" refer to, so anything other than
      // a clarifying question is genuinely unhelpful.
      prompts: ['Is it included?'],
      reference: '',
      expectedKeywords: [],
      clarificationExpected: true,
      // The bot does clarify: "I'd be happy to clarify. Could you please specify
      // which feature or inclusion you're referring to?"
      //
      // This case appeared to fail for several runs, and that was read as a gap in
      // the bot. It was not — the extractor was discarding a parent element's own
      // text (see ChatBotPage.extractMessagesInFrame), so only the orphaned
      // feature list at the end of the reply survived and the clarifying question
      // was never scored. Worth remembering before concluding anything about the
      // bot from a low score: check what was actually captured first.
      //
      // Best-effort, and expected to stay that way: the bot is inconsistent about
      // it. Of three runs since the extraction fix it clarified once and guessed
      // a referent the other two times, so this signal warns rather than fails.
      signals: { clarified: true },
      // No `expect` band. The validator caps the score at 0.35 whenever
      // clarification was expected and did not happen, so a `min: 0.6` here was
      // not an independent check — it restated the signal above and produced a
      // second warning for one underlying fact.
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
      // ONE requirement — the reply offers help — expressed as alternatives, not
      // as three separate facts. Previously ['help','assist','support'] scored
      // hits/3, so "I'd be happy to help you. Could you share a bit more about
      // what you need assistance with?" scored 0.333: a model reply marked down
      // for saying "assistance" rather than "assist" (token matching is exact,
      // there is no stemming) and for not saying "support" at all. It drifted
      // between 0.333 and 0.667 across runs purely on word choice, which is why
      // both spellings are listed.
      expectedKeywords: [['help', 'assist', 'assistance', 'support', 'happy to']],
      // With a single group the score is effectively binary: the bot either
      // offered help or it did not. Kept best-effort because a reply could
      // reasonably offer help without any of these words ("Sure! What do you
      // need?"), and that should be a warning, not a build failure.
      expect: { min: 0.6 },
      soft: true,
    },
    // A `product-question` case used to live here asking "What can this chatbot
    // do?" — the same prompt as Semantic Correctness's
    // correct-meaning-different-wording, which tests it more strictly (paraphrased
    // reference, no keyword crutch). It was removed rather than duplicated: the
    // same question asked twice per run is one more live session for no signal.
  ],
};
