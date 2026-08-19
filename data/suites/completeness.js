/**
 * Completeness — does the reply cover everything that was asked?
 *
 * Measured through keyword coverage: the reference lists the facts a complete
 * answer would contain, and coverage reports what fraction actually arrived.
 */
module.exports = {
  suite: 'Completeness',
  // Completeness is keyword coverage, which lives in the semantic score.
  weights: { semanticCorrectness: 1 },
  description: 'The reply covers every part of a multi-part question.',
  cases: [
    {
      name: 'partial-answer',
      // Two-part question, deliberately built so only one part is answerable: the
      // bot always quotes the Growth price, and has no access to company headcount
      // (observed: it drops that half of the question silently).
      //
      // An earlier version asked three product questions (pricing / refunds /
      // certifications) and assumed the bot could not cover them all — but it can,
      // and did, scoring 0.86 and breaking the ceiling. Partial-ness now comes from
      // the question's construction rather than from the bot's mood: coverage is
      // pinned at 0.5, which caps the score at 0.7*0.5 + 0.3*1 = 0.65 even in the
      // best case.
      prompts: ['What is the price of the Growth plan, and how many employees does your company have?'],
      // The headcount is a stand-in for a fact the public bot cannot reach — it is
      // NOT a claim about the real company. It exists so the reply can only ever
      // cover half the reference, which is the whole point of this case.
      reference:
        'The Growth plan costs $79 per user per month billed annually, ' +
        'and the company has about 250 employees.',
      expectedKeywords: ['79', '250'],
      expect: { min: 0.25, max: 0.75 }, // expected to land in the middle
      soft: true, // best-effort: the live bot's wording still varies
    },
  ],
};
