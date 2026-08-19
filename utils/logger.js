/**
 * Minimal leveled logger with consistent, prefixed output.
 *
 * Centralizing log formatting keeps validator/engine/page-object output uniform
 * and makes it easy to change verbosity in one place (via LOG_LEVEL env var).
 */

const LEVELS = { debug: 10, info: 20, score: 20, warn: 30, error: 40, silent: 99 };

const currentLevel = LEVELS[(process.env.LOG_LEVEL || 'info').toLowerCase()] ?? LEVELS.info;

function timestamp() {
  return new Date().toISOString().replace('T', ' ').replace('Z', '');
}

function emit(level, tag, args) {
  if (LEVELS[level] < currentLevel) return;
  const line = `${timestamp()} [${tag}]`;
  const sink = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  sink(line, ...args);
}

module.exports = {
  debug: (...args) => emit('debug', 'DEBUG', args),
  info: (...args) => emit('info', 'INFO', args),
  warn: (...args) => emit('warn', 'WARN', args),
  error: (...args) => emit('error', 'ERROR', args),
  /** Dedicated channel for validator score lines. */
  score: (...args) => emit('score', 'SCORE', args),
};
