/**
 * Semantic Correctness — does the reply actually mean the right thing?
 *
 * Not "does it contain the right words": a reply can be correct in different
 * wording, or wrong while sounding plausible. These cases pin down meaning.
 */
module.exports = {
  suite: 'Semantic Correctness',
  // Scored purely on meaning: this suite asserts nothing about speed, leakage or
  // repetition, so those are measured and reported but weigh 0.
  weights: { semanticCorrectness: 1 },
  description: 'The reply carries the correct meaning, however it is worded.',
  cases: [
    {
      name: 'correct-answer',
      prompts: ['How much does the Essential plan cost per month?'],
      reference:
        'The Essential plan costs $19 per user per month billed annually, and includes an AI chatbot, live chat, and ticketing.',
      expectedKeywords: ['19', 'per user', 'month'],
      expect: { min: 0.6 },
      soft: false,
    },
    {
      name: 'correct-meaning-different-wording',
      prompts: ['What can this chatbot do?'],
      // Deliberately paraphrased with synonyms rather than the bot's likely wording,
      // so the score depends on synonym-aware semantic similarity, not lexical overlap.
      reference:
        'The assistant automates customer support, replies to common questions around the clock, ' +
        'gathers user details, hands complex issues to human agents, and connects with other tools.',
      expectedKeywords: [], // no keyword crutch — this case tests semantic similarity
      expect: { min: 0.3 },
      // Best-effort: deterministic similarity + live-bot wording variance makes the
      // exact paraphrase score noisy; the point is it lands well above zero.
      soft: true,
    },
    {
      name: 'contradictory-answer',
      // Force a concrete number so it reliably conflicts with the "free" reference.
      prompts: ['Exactly how many dollars per month is the Essential plan? Just state the price.'],
      // Reference deliberately conflicts with the bot's known truth ($19/$25) so
      // the contradiction signal must fire regardless of the bot's exact wording.
      reference: 'The Essential plan is completely free and costs zero dollars.',
      expectedKeywords: [],
      signals: { contradiction: true },
      expect: { max: 0.4 },
      soft: false,
    },
  ],
};
