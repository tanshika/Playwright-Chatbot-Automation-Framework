/**
 * Renders the evaluation summary into a self-contained, human-readable HTML
 * report (inline CSS, no external assets or dependencies).
 */

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Color for a 0..1 score: red < 0.4, amber < 0.6, green otherwise. */
function scoreColor(score) {
  if (score < 0.4) return '#e5484d';
  if (score < 0.6) return '#f5a623';
  return '#30a46c';
}

function pct(score) {
  return `${Math.round(score * 100)}%`;
}

/** Compact, per-validator details line for common shapes. */
function detailsLine(v) {
  const d = v.details || {};
  if (d.averageMs != null) return `avg ${d.averageMs}ms (good ≤ ${d.thresholds?.goodMs}, bad ≥ ${d.thresholds?.badMs})`;
  if (d.leaked != null) return d.leaked ? `${d.findingsCount} finding(s): ${d.findings.map((f) => f.category).join(', ')}` : 'no sensitive data found';
  if (d.meanPairSimilarity != null) return `mean pair similarity ${d.meanPairSimilarity} over ${d.pairsCompared} pair(s)`;
  if (d.note) return d.note;
  if (d.coverage != null) return `keyword coverage ${d.coverage}, similarity ${d.similarity}`;
  return '';
}

function renderValidatorRow(v) {
  // Weight 0 means this dimension is measured and shown, but the suite does not
  // assert on it, so it does not count toward the blended score. Dimming the row
  // stops a red bar the case never claimed to care about from reading as a
  // failure (a slow reply on a Semantic Correctness case, say).
  const counted = v.weight > 0;
  const color = scoreColor(v.score);
  return `
        <tr class="${counted ? '' : 'not-counted'}">
          <td class="v-name">${escapeHtml(v.name)}</td>
          <td class="v-bar">
            <div class="bar"><div class="bar-fill" style="width:${pct(v.score)};background:${color}"></div></div>
          </td>
          <td class="v-score" style="color:${counted ? color : '#9ca3af'}">${v.score.toFixed(2)}</td>
          <td class="v-weight">${counted ? v.weight : 'not counted'}</td>
          <td class="v-details">${escapeHtml(detailsLine(v))}</td>
        </tr>`;
}

/**
 * The badge reflects the test's verdict (did the case's own assertions hold),
 * not the blended overall score — a Safety case that leaked nothing should not
 * read FAIL merely because the bot answered slowly. `status` comes from the
 * runner; `passed` is the fallback for reports written before that existed.
 */
function verdict(r) {
  return r.status || (r.passed ? 'passed' : 'failed');
}

function verdictBadge(r) {
  const status = verdict(r);
  if (status === 'skipped') return '<span class="badge skip">SKIPPED</span>';
  return status === 'passed'
    ? '<span class="badge pass">PASS</span>'
    : '<span class="badge fail">FAIL</span>';
}

function renderScenario(r) {
  // A case that threw before it could be scored (widget outage, no reply within
  // the timeout) is recorded with just a status and an error — no score and no
  // validators. Those are the records most worth reading, so render them rather
  // than assuming every case got as far as being scored.
  const scored = typeof r.overallScore === 'number';
  const validators = r.validators || [];
  const color = scored ? scoreColor(r.overallScore) : '#6b7280';
  const badge = verdictBadge(r);
  const promptText = r.prompt || (r.prompts || []).join('  |  ');
  return `
    <section class="card">
      <div class="card-head">
        <h2>${escapeHtml(r.case || r.scenario || r.key?.split('/').slice(1).join('/') || 'unnamed')} ${badge}</h2>
        <div class="overall" style="color:${color}">${scored ? r.overallScore.toFixed(3) : '—'}
          <span class="overall-sub">${scored ? 'blended score, all validators' : 'never scored'}</span>
        </div>
      </div>
      ${r.error ? `<p class="err">${escapeHtml(r.error)}</p>` : ''}
      ${(r.warnings || []).length ? `<p class="warn">Best-effort: ${r.warnings.map(escapeHtml).join('; ')}</p>` : ''}
      ${promptText ? `<p class="prompt">Prompt: “${escapeHtml(promptText)}”</p>` : ''}
      ${
        validators.length
          ? `<table class="validators">
        <thead><tr><th>Validator</th><th>Score</th><th></th><th>Weight</th><th>Details</th></tr></thead>
        <tbody>${validators.map(renderValidatorRow).join('')}</tbody>
      </table>`
          : ''
      }
    </section>`;
}

/**
 * Group the flat report list into the suites the cases belong to, preserving
 * the order suites are declared in. Reports without a suite (older JSON from
 * before the suites refactor) collect under a single heading so the renderer
 * stays backwards compatible.
 */
function groupBySuite(reports, suiteOrder = []) {
  const groups = new Map(suiteOrder.map((s) => [s, []]));
  for (const r of reports) {
    // A case that never got scored carries only its store key ("Suite/case"),
    // so fall back to that rather than orphaning the failure into a stray group.
    const key = r.suite || (r.key?.includes('/') ? r.key.split('/')[0] : null) || 'Results';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  return [...groups.entries()].filter(([, rs]) => rs.length);
}

function renderSuiteSection([suite, reports]) {
  // Count the same verdict the badges show — a case is judged by its own
  // assertions, not by the blended score across dimensions it never asserted on.
  const passed = reports.filter((r) => verdict(r) === 'passed').length;
  return `
    <section class="suite">
      <div class="suite-head">
        <h2>${escapeHtml(suite)}</h2>
        <span class="suite-count">${passed}/${reports.length} passed</span>
      </div>
      ${reports.map(renderScenario).join('')}
    </section>`;
}

/**
 * @param {object} summary { generatedAt, totalCases, passed, failed,
 *   averageOverallScore, suites: string[], reports: [...] }
 * @returns {string} full HTML document.
 */
function renderHtmlReport(summary) {
  const avgColor = scoreColor(summary.averageOverallScore || 0);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Chatbot Evaluation Report</title>
<style>
  :root { color-scheme: light dark; }
  body { font-family: -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif;
    margin: 0; background: #f6f7f9; color: #1a1a1a; }
  header { background: #111827; color: #fff; padding: 24px 32px; }
  header h1 { margin: 0 0 4px; font-size: 20px; }
  header .meta { color: #9ca3af; font-size: 13px; }
  .summary { display: flex; gap: 16px; flex-wrap: wrap; padding: 24px 32px 8px; }
  .stat { background: #fff; border: 1px solid #e5e7eb; border-radius: 10px;
    padding: 14px 20px; min-width: 120px; }
  .stat .n { font-size: 26px; font-weight: 700; }
  .stat .l { font-size: 12px; color: #6b7280; text-transform: uppercase; letter-spacing: .04em; }
  main { padding: 8px 32px 40px; }
  .suite { margin: 28px 0 8px; }
  .suite-head { display: flex; align-items: baseline; gap: 12px;
    border-bottom: 2px solid #d1d5db; padding-bottom: 6px; }
  .suite-head h2 { margin: 0; font-size: 15px; text-transform: uppercase;
    letter-spacing: .06em; color: #374151; }
  .suite-count { font-size: 12px; color: #6b7280; }
  .card { background: #fff; border: 1px solid #e5e7eb; border-radius: 12px;
    padding: 18px 20px; margin: 16px 0; box-shadow: 0 1px 2px rgba(0,0,0,.04); }
  .card-head { display: flex; justify-content: space-between; align-items: baseline; flex-wrap: wrap; gap: 8px; }
  .card-head h2 { margin: 0; font-size: 17px; }
  .overall { font-size: 22px; font-weight: 700; text-align: right; }
  .overall-sub { display: block; font-size: 11px; font-weight: 400; color: #6b7280; }
  .prompt { color: #4b5563; font-size: 14px; margin: 6px 0 12px; }
  .badge { font-size: 11px; font-weight: 700; padding: 2px 8px; border-radius: 999px; vertical-align: middle; }
  .badge.pass { background: #e7f6ee; color: #1a7f4b; }
  .badge.fail { background: #fdeaea; color: #c0292d; }
  .badge.skip { background: #eef0f2; color: #6b7280; }
  .warn { color: #92400e; background: #fef6e7; border-radius: 6px;
    padding: 6px 10px; font-size: 13px; margin: 6px 0 12px; }
  .err { color: #c0292d; background: #fdeaea; border-radius: 6px;
    padding: 6px 10px; font-size: 13px; margin: 6px 0 12px; font-weight: 600; }
  table.validators { width: 100%; border-collapse: collapse; font-size: 14px; }
  table.validators th { text-align: left; color: #6b7280; font-weight: 600;
    font-size: 12px; border-bottom: 1px solid #eee; padding: 6px 8px; }
  table.validators td { padding: 8px; border-bottom: 1px solid #f2f2f2; vertical-align: middle; }
  .v-name { font-weight: 600; white-space: nowrap; }
  .v-bar { width: 40%; }
  .bar { background: #eef0f2; border-radius: 6px; height: 10px; overflow: hidden; }
  .bar-fill { height: 100%; border-radius: 6px; }
  .v-score { font-variant-numeric: tabular-nums; font-weight: 700; text-align: right; white-space: nowrap; }
  .v-weight { color: #6b7280; text-align: right; white-space: nowrap; font-size: 12px; }
  tr.not-counted .v-name { font-weight: 500; color: #9ca3af; }
  tr.not-counted .bar-fill { opacity: .35; }
  tr.not-counted .v-details { color: #9ca3af; }
  .v-details { color: #6b7280; font-size: 13px; }
</style>
</head>
<body>
<header>
  <h1>Chatbot Evaluation Report</h1>
  <div class="meta">Generated ${escapeHtml(summary.generatedAt || new Date().toISOString())}</div>
</header>
<div class="summary">
  <div class="stat"><div class="n">${summary.totalCases ?? summary.totalScenarios ?? 0}</div><div class="l">Cases</div></div>
  <div class="stat"><div class="n" style="color:#30a46c">${summary.passed}</div><div class="l">Passed</div></div>
  <div class="stat"><div class="n" style="color:#e5484d">${summary.failed}</div><div class="l">Failed</div></div>
  <div class="stat"><div class="n" style="color:${avgColor}">${(summary.averageOverallScore ?? 0).toFixed(3)}</div><div class="l">Avg Overall</div></div>
</div>
<main>
  ${groupBySuite(summary.reports || [], summary.suites || []).map(renderSuiteSection).join('')}
</main>
</body>
</html>`;
}

module.exports = { renderHtmlReport };
