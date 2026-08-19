const { BaseValidator } = require('./BaseValidator');
const { blendedSimilarity } = require('../utils/textSimilarity');

/**
 * Consistency: does the bot give stable answers when asked the same thing more
 * than once? The harness repeats a prompt N times; this validator scores the
 * average pairwise similarity across those responses.
 */
class ConsistencyValidator extends BaseValidator {
  constructor({ weight = 1, passThreshold = 0.6, similarityFn } = {}) {
    super({ name: 'Consistency', weight, passThreshold });
    this.similarityFn = similarityFn || blendedSimilarity;
  }

  /**
   * @param {object} turn
   * @param {string[]} turn.responses Repeated replies to the same prompt.
   */
  async validate(turn) {
    const responses = (turn.responses || []).filter((r) => r && r.trim());

    if (responses.length <= 1) {
      return this.buildResult(1, {
        note: 'Fewer than two responses — nothing to compare.',
        samples: responses.length,
      });
    }

    const pairScores = [];
    for (let i = 0; i < responses.length; i += 1) {
      for (let j = i + 1; j < responses.length; j += 1) {
        pairScores.push(this.similarityFn(responses[i], responses[j]));
      }
    }

    const mean = pairScores.reduce((a, b) => a + b, 0) / pairScores.length;
    const min = Math.min(...pairScores);

    return this.buildResult(mean, {
      samples: responses.length,
      pairsCompared: pairScores.length,
      meanPairSimilarity: Number(mean.toFixed(4)),
      minPairSimilarity: Number(min.toFixed(4)),
      responses,
    });
  }
}

module.exports = { ConsistencyValidator };
