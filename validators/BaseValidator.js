/**
 * BaseValidator: common contract for all validators.
 *
 * Every validator produces a normalized result of the shape:
 *   { name, score: 0..1, weight, passed, details }
 * so the EvaluationEngine can combine and report them uniformly.
 */
class BaseValidator {
  /**
   * @param {object} opts
   * @param {string} opts.name  Human-readable validator name.
   * @param {number} opts.weight Relative weight in the overall score.
   * @param {number} [opts.passThreshold] Per-validator pass cutoff (0..1).
   */
  constructor({ name, weight, passThreshold = 0.6 }) {
    this.name = name;
    this.weight = weight;
    this.passThreshold = passThreshold;
  }

  /** Clamp any number into the [0, 1] range. */
  clamp01(n) {
    if (Number.isNaN(n) || n == null) return 0;
    return Math.max(0, Math.min(1, n));
  }

  /** Build the standard result object returned by every validator. */
  buildResult(score, details = {}) {
    const clamped = this.clamp01(score);
    return {
      name: this.name,
      score: Number(clamped.toFixed(4)),
      weight: this.weight,
      passed: clamped >= this.passThreshold,
      details,
    };
  }

  /**
   * Subclasses must implement `validate` and return `this.buildResult(...)`.
   * The argument is a "turn" describing one exchange with the bot (and, where
   * relevant, repeated responses for consistency).
   */
  // eslint-disable-next-line no-unused-vars
  async validate(turn) {
    throw new Error(`${this.name}: validate() not implemented`);
  }
}

module.exports = { BaseValidator };
