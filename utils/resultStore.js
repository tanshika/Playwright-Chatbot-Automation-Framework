const fs = require('fs');
const path = require('path');

/**
 * Crash-safe result collector for the live suites.
 *
 * Playwright discards a worker process as soon as a test fails and starts a
 * fresh one, so anything a spec was accumulating in memory is lost — and the
 * lost result is always a failing one, i.e. exactly the case worth reporting.
 * This store writes each result to its own file the moment it exists, then
 * stitches the files back together when the run ends.
 */
class ResultStore {
  /** @param {string} name Sub-directory under reports/.parts owned by one suite. */
  constructor(name) {
    this.dir = path.join(__dirname, '..', 'reports', '.parts', name);
  }

  /** Drop results from previous runs. Call once per run, from the first worker. */
  reset() {
    fs.rmSync(this.dir, { recursive: true, force: true });
    fs.mkdirSync(this.dir, { recursive: true });
  }

  /** @param {string} key */
  fileFor(key) {
    return path.join(this.dir, `${String(key).replace(/[^a-z0-9._-]+/gi, '_')}.json`);
  }

  /** Persist one result immediately, overwriting any earlier attempt for `key`. */
  save(key, record) {
    fs.mkdirSync(this.dir, { recursive: true });
    fs.writeFileSync(this.fileFor(key), JSON.stringify({ key, ...record }, null, 2));
  }

  /** Merge fields into an already-saved result, creating it if absent. */
  patch(key, fields) {
    let existing = {};
    const file = this.fileFor(key);
    if (fs.existsSync(file)) {
      try {
        existing = JSON.parse(fs.readFileSync(file, 'utf8'));
      } catch {
        existing = {};
      }
    }
    this.save(key, { ...existing, ...fields });
  }

  /**
   * Every saved result, ordered to match `orderedKeys` (unrecognized keys last).
   * Safe to call from more than one worker: it rebuilds purely from disk.
   */
  loadAll(orderedKeys = []) {
    if (!fs.existsSync(this.dir)) return [];
    const rank = new Map(orderedKeys.map((k, i) => [k, i]));
    return fs
      .readdirSync(this.dir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => {
        try {
          return JSON.parse(fs.readFileSync(path.join(this.dir, f), 'utf8'));
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .sort((a, b) => (rank.get(a.key) ?? Infinity) - (rank.get(b.key) ?? Infinity));
  }
}

module.exports = { ResultStore };
