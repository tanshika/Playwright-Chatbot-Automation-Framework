const { BaseValidator } = require('./BaseValidator');
const { keywordCoverage } = require('../utils/textSimilarity');
const {
  semanticSimilarity,
  detectContradiction,
  grounding,
  detectClarification,
} = require('../utils/semanticSignals');

/**
 * Semantic Correctness: how well the bot's reply answers the question.
 *
 * Deterministic, offline, multi-signal scorer:
 *   - coverage    : fraction of required facts present
 *   - similarity  : synonym-aware closeness to the reference answer
 *   - contradiction (always) : caps the score when the reply conflicts with the
 *                              reference (price/antonym/polarity conflict)
 *   - grounding   (opt-in, checkGrounding)      : penalizes invented/unsupported facts
 *   - clarification (opt-in, clarificationExpected): for ambiguous prompts, asking a
 *                              clarifying question is the correct behavior
 *
 * `context` (prior turns) is merged into the reference so follow-up replies can
 * be judged against the resolved conversation.
 */
class SemanticCorrectnessValidator extends BaseValidator {
  constructor({ weight = 1, passThreshold = 0.6, coverageFn, similarityFn } = {}) {
    super({ name: 'Semantic Correctness', weight, passThreshold });
    this.coverageFn = coverageFn || keywordCoverage;
    this.similarityFn = similarityFn || semanticSimilarity;
  }

  /**
   * @param {object} turn
   * @param {string}   turn.response
   * @param {string}   [turn.reference|turn.expectedAnswer] reference answer text
   * @param {string[]} [turn.expectedKeywords]
   * @param {Array<{role?:string,text:string}|string>} [turn.context] prior turns
   * @param {boolean}  [turn.checkGrounding]        apply the grounding signal
   * @param {boolean}  [turn.clarificationExpected] treat clarifying as correct
   */
  async validate(turn) {
    const {
      response = '',
      reference,
      expectedAnswer,
      expectedKeywords = [],
      context = [],
      checkGrounding = false,
      clarificationExpected = false,
    } = turn;

    const referenceAnswer = reference ?? expectedAnswer ?? '';
    const contextText = context.map((c) => (typeof c === 'string' ? c : c.text || '')).join(' ');
    const referenceText = `${contextText} ${referenceAnswer}`.trim();

    // --- base signals ---
    const coverage = this.coverageFn(response, expectedKeywords);
    const similarity = referenceText ? await this.similarityFn(response, referenceText) : coverage;
    let score = expectedKeywords.length ? 0.7 * coverage + 0.3 * similarity : similarity;

    // --- grounding (opt-in) ---
    const groundingResult = referenceText ? grounding(response, referenceText) : { score: 1, unsupported: [] };
    if (checkGrounding) score = 0.5 * score + 0.5 * groundingResult.score;

    // --- contradiction (always applied) ---
    const contradiction = detectContradiction(response, referenceText);
    if (contradiction.contradicted) score = Math.min(score, 0.25);

    // --- clarification (opt-in, dominates for ambiguous prompts) ---
    const clarified = detectClarification(response);
    if (clarificationExpected) score = clarified ? Math.max(score, 0.8) : Math.min(score, 0.35);

    return this.buildResult(score, {
      coverage: Number(coverage.toFixed(4)),
      similarity: Number(similarity.toFixed(4)),
      grounding: Number(groundingResult.score.toFixed(4)),
      groundingApplied: checkGrounding,
      unsupported: groundingResult.unsupported.slice(0, 8),
      contradiction: contradiction.contradicted,
      contradictionReasons: contradiction.reasons,
      clarificationExpected,
      clarified,
      usedContext: context.length > 0,
      expectedKeywords,
    });
  }
}

module.exports = { SemanticCorrectnessValidator };
