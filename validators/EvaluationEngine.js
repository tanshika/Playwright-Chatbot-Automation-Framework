const config = require('../config/framework.config');
const logger = require('../utils/logger');
const { SemanticCorrectnessValidator } = require('./SemanticCorrectnessValidator');
const { SensitiveInfoValidator } = require('./SensitiveInfoValidator');
const { ConsistencyValidator } = require('./ConsistencyValidator');
const { LatencyValidator } = require('./LatencyValidator');

/**
 * EvaluationEngine: runs every validator against a conversation turn and blends
 * their individual scores into a single weighted overall evaluation.
 *
 * A "turn" is a plain object carrying whatever the validators need, e.g.:
 *   {
 *     scenario, prompt,
 *     response,            // bot reply (semantic + leakage)
 *     expectedAnswer, expectedKeywords, allowList,
 *     responses,           // repeated replies (consistency)
 *     latencyMs | latenciesMs,
 *   }
 */
class EvaluationEngine {
  /**
   * @param {object} [opts]
   * @param {BaseValidator[]} [opts.validators] Override the default validator set.
   * @param {object} [opts.weights] Per-dimension weights for the blended score.
   *        Missing dimensions weigh 0: they are still measured and reported, but
   *        do not count toward the blend. Suites use this so a case is scored on
   *        what it actually claims to test — a Semantic Correctness case should
   *        not be dragged down by latency it never asserted on, and a case with
   *        one response should not collect a free 1.0 from Consistency, which
   *        returns "nothing to compare" rather than a measurement.
   * @param {number} [opts.passThreshold]
   */
  constructor({ validators, weights = config.weights, passThreshold = config.passThreshold } = {}) {
    this.passThreshold = passThreshold;
    this.validators =
      validators || [
        new SemanticCorrectnessValidator({ weight: weights.semanticCorrectness ?? 0 }),
        new SensitiveInfoValidator({ weight: weights.sensitiveInfo ?? 0 }),
        new ConsistencyValidator({ weight: weights.consistency ?? 0 }),
        new LatencyValidator({ weight: weights.latency ?? 0 }),
      ];
  }

  /**
   * Evaluate a single turn.
   * @returns {Promise<object>} full evaluation report.
   */
  async evaluate(turn = {}) {
    const results = [];
    for (const validator of this.validators) {
      const result = await validator.validate(turn);
      logger.score(`${result.name}: ${result.score} (weight ${result.weight})`);
      results.push(result);
    }

    const totalWeight = results.reduce((sum, r) => sum + r.weight, 0) || 1;
    const overallScore = results.reduce((sum, r) => sum + r.score * r.weight, 0) / totalWeight;
    const passed = overallScore >= this.passThreshold;

    const report = {
      scenario: turn.scenario || turn.prompt || 'unnamed',
      prompt: turn.prompt,
      overallScore: Number(overallScore.toFixed(4)),
      passThreshold: this.passThreshold,
      passed,
      validators: results,
      timestamp: new Date().toISOString(),
    };

    logger.score(
      `OVERALL "${report.scenario}": ${report.overallScore} => ${passed ? 'PASS' : 'FAIL'}`,
    );
    return report;
  }

  /** Evaluate many turns and return per-turn reports plus an aggregate summary. */
  async evaluateAll(turns = []) {
    const reports = [];
    for (const turn of turns) reports.push(await this.evaluate(turn));

    const avg = (key) =>
      reports.length ? reports.reduce((s, r) => s + r[key], 0) / reports.length : 0;

    return {
      reports,
      summary: {
        totalScenarios: reports.length,
        passed: reports.filter((r) => r.passed).length,
        failed: reports.filter((r) => !r.passed).length,
        averageOverallScore: Number(avg('overallScore').toFixed(4)),
      },
    };
  }
}

module.exports = { EvaluationEngine };
