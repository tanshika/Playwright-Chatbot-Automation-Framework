/**
 * Consistency — does the bot give the same answer to the same question, and hold
 * on to what it was told earlier in the conversation?
 *
 * Note what the Consistency validator actually measures: similarity between
 * whole replies. Two replies can state the identical fact and still score ~0.6
 * because their trailing pleasantries differ. So correctness is gated by the
 * semantic band, and reply similarity is carried as a best-effort signal.
 */
module.exports = {
  suite: 'Consistency',
  // Both halves matter: replies must agree with each other and be correct, so a
  // bot that is reliably wrong does not score well.
  weights: { consistency: 0.5, semanticCorrectness: 0.5 },
  description: 'The same question gets the same answer, and stated facts survive the conversation.',
  cases: [
    {
      name: 'consistent-conversation-context',
      // Turn 1 states a fact the bot has no other way of knowing; turn 2 asks for
      // it back. The name appearing in the reply is itself the proof that context
      // survived the turn — no scorer context needed to demonstrate it, so
      // contextTurns is deliberately left off (merging turn 1 into the reference
      // would only dilute similarity against the short reference below).
      prompts: ['My name is Alice.', "What's my name?"],
      reference: 'Your name is Alice.',
      expectedKeywords: ['alice'],
      // Recalling the name once could be luck, so the conversation runs several
      // times, each in a fresh session — a reused one would only show the bot
      // remembering the previous repeat. The band applies to the worst repeat:
      // answering correctly most of the time is not "consistently".
      repeat: 3,
      expect: { min: 0.6 },
      consistency: { min: 0.5 }, // phrasing stability only — see the note above
      soft: false,
    },
    {
      name: 'pricing-consistency',
      // Same question twice in fresh sessions: does the bot quote pricing the
      // same way both times? The subject is named outright rather than left to a
      // pronoun — with an ambiguous question, replies that differ could just be
      // the bot guessing at different subjects, which is indistinguishable from
      // genuine instability.
      prompts: ['What are your pricing plans?'],
      repeat: 2,
      expectedKeywords: ['essential', 'growth', 'enterprise'],
      consistency: { min: 0.5 },
      // This case is about stability rather than correctness, so the semantic
      // floor is low and best-effort.
      expect: { min: 0.4 },
      soft: true,
    },
  ],
};
