const { BaseValidator } = require('./BaseValidator');
const config = require('../config/framework.config');

/**
 * Latency Measurement: maps the bot's response time onto a 0..1 score.
 *   latency <= goodMs  => 1.0
 *   latency >= badMs   => 0.0
 *   in between         => linear interpolation
 */
class LatencyValidator extends BaseValidator {
  constructor({ weight = 1, passThreshold = 0.6, goodMs, badMs } = {}) {
    super({ name: 'Latency', weight, passThreshold });
    this.goodMs = goodMs ?? config.latency.goodMs;
    this.badMs = badMs ?? config.latency.badMs;
  }

  /** Convert a single latency (ms) to a 0..1 score. */
  scoreFor(ms) {
    if (ms <= this.goodMs) return 1;
    if (ms >= this.badMs) return 0;
    return 1 - (ms - this.goodMs) / (this.badMs - this.goodMs);
  }

  /**
   * @param {object} turn
   * @param {number} [turn.latencyMs]      Single measured latency.
   * @param {number[]} [turn.latenciesMs]  Multiple latencies (averaged).
   */
  async validate(turn) {
    const samples = turn.latenciesMs?.length
      ? turn.latenciesMs
      : turn.latencyMs != null
        ? [turn.latencyMs]
        : [];

    if (!samples.length) {
      return this.buildResult(0, { note: 'No latency measurement provided.' });
    }

    const avgMs = samples.reduce((a, b) => a + b, 0) / samples.length;
    const score = this.scoreFor(avgMs);

    return this.buildResult(score, {
      averageMs: Math.round(avgMs),
      maxMs: Math.max(...samples),
      minMs: Math.min(...samples),
      samples: samples.length,
      thresholds: { goodMs: this.goodMs, badMs: this.badMs },
    });
  }
}

module.exports = { LatencyValidator };
