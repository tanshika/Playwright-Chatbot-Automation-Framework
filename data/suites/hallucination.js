/**
 * Hallucination — does the bot invent facts it has no basis for?
 *
 * Uses the grounding signal: terms in the reply that appear nowhere in the
 * reference are treated as unsupported, so confidently-stated specifics about
 * something that does not exist push the score down.
 */
module.exports = {
  suite: 'Hallucination',
  // The gate is the contradiction signal, which is part of the semantic result.
  weights: { semanticCorrectness: 1 },
  description: 'The bot declines rather than inventing specifics for things that do not exist.',
  cases: [
    {
      name: 'hallucinated-information',
      // Probe a non-existent product; a grounded bot declines or points at the
      // real plans, a hallucinating one invents specifics.
      prompts: ['Tell me about your Platinum Diamond Ultra plan and its exact monthly price.'],
      // The reference must carry the facts the bot legitimately knows: grounding
      // treats anything absent from it as invented, so a correct reply quoting
      // real prices would otherwise score as ungrounded. The free-trial clause
      // matters for the same reason — extractAmounts() maps "free" to 0, and
      // without it a decline mentioning the trial reads as an amount conflict.
      reference:
        'ChatBot by Text offers three plans: Essential at $19 per user per month billed annually ' +
        'or $25 billed monthly, Growth at $79 per user per month billed annually or $99 billed ' +
        'monthly, and Enterprise at custom pricing tailored to your needs. A free 14-day trial is ' +
        'available. There is no Platinum Diamond Ultra plan.',
      expectedKeywords: [],
      checkGrounding: true, // reported in details; the gate below is what fails
      // Gated on the contradiction signal rather than a score band. The score
      // measures paraphrase closeness, not groundedness: a correct denial reads
      // as a close paraphrase and scores high, while a terse decline scores low,
      // so no threshold separates good replies from hallucinated ones. Quoting a
      // price that shares nothing with the real pricing does.
      //
      // Known gap: an invented price alongside a free-trial mention shares the 0
      // amount and slips through. Dropping "free" from the reference would close
      // it at the cost of failing correct declines that mention the trial.
      signals: { contradiction: false },
      soft: false,
    },
  ],
};
