const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');
const { ChatBotPage, WidgetUnavailableError } = require('../pages/ChatBotPage');
const { EvaluationEngine } = require('../validators/EvaluationEngine');
const { SemanticCorrectnessValidator } = require('../validators/SemanticCorrectnessValidator');
const suites = require('../data/suites');
const config = require('../config/framework.config');
const logger = require('../utils/logger');
const { renderHtmlReport } = require('../utils/htmlReport');
const { ResultStore } = require('../utils/resultStore');

// One engine per suite: each blends only the dimensions that suite asserts on,
// so the headline score means "how did this case do at its own job" rather than
// averaging in dimensions it never claimed to test. Suites that declare no
// weights fall back to the global defaults in config.
const engines = new Map(
  suites.map((s) => [s.suite, new EvaluationEngine(s.weights ? { weights: s.weights } : {})]),
);
// Used only to pick the worst run of a repeated conversation before the full
// report card is built; offline and deterministic, so re-scoring costs nothing.
const semanticScorer = new SemanticCorrectnessValidator();
const store = new ResultStore('suites');

// Both belong to the test currently running. Safe because the live suites run
// serially (workers: 1, fullyParallel: false).
let warnings = [];
let currentKey = null;
let currentMeta = null;

/** Open the widget, or skip the test if the widget is unavailable externally. */
async function openOrSkip(chat) {
  try {
    await chat.open();
  } catch (e) {
    if (e.name === 'WidgetUnavailableError' || e instanceof WidgetUnavailableError) {
      test.skip(true, e.message);
      return;
    }
    throw e;
  }
}

/** Assert helper that downgrades to a warning for best-effort checks. */
function checkOrWarn(soft, label, fn) {
  if (soft) {
    try {
      fn();
    } catch (e) {
      const warning = `${label}: ${e.message.split('\n')[0]}`;
      warnings.push(warning);
      logger.warn(`[best-effort] ${warning}`);
    }
  } else {
    fn();
  }
}

/**
 * Run one conversation to completion in the given page.
 * @returns {Promise<{exchanges: Array, latenciesMs: number[]}>}
 */
async function runConversation(page, prompts) {
  const chat = new ChatBotPage(page);
  await openOrSkip(chat);

  const exchanges = [];
  const latenciesMs = [];
  for (const prompt of prompts) {
    const { response, latencyMs, settled } = await chat.askAndMeasure(prompt);
    exchanges.push({ prompt, response });
    latenciesMs.push(latencyMs);
    // Carried into the report: an unsettled reply may be truncated, so any score
    // derived from it — and its latency — should be read with suspicion.
    if (!settled) warnings.push(`reply never settled for "${prompt}" (text may be truncated)`);
  }
  return { exchanges, latenciesMs };
}

/** Scorer context built from the leading exchanges (for follow-up cases). */
function contextFrom(exchanges, contextTurns) {
  return exchanges.slice(0, contextTurns || 0).flatMap((e) => [
    { role: 'visitor', text: e.prompt },
    { role: 'bot', text: e.response },
  ]);
}

// File-level, so it runs once per worker rather than once per suite — a
// per-suite reset would wipe the previous suite's results. Worker 0 is the first
// worker of the run; later indexes are restarts, which must not clear results
// the earlier workers already stored.
test.beforeAll(async ({}, testInfo) => {
  if (testInfo.workerIndex === 0) store.reset();
});

for (const { suite, description, cases } of suites) {
  test.describe(suite, () => {
    test.beforeAll(() => {
      logger.info(`\n━━ ${suite} — ${description}`);
    });

    for (const c of cases) {
      test(c.name, async ({ page, browser }) => {
        warnings = [];
        currentKey = `${suite}/${c.name}`;
        // Recorded now so a case that dies before it can be scored still lands
        // in the report under its own suite.
        currentMeta = { suite, case: c.name, prompts: c.prompts };
        const repeat = Math.max(1, c.repeat || 1);

        // Run the conversation `repeat` times. Every repeat after the first gets
        // a brand-new browser context: reusing the session would let the bot
        // answer from the *previous* repeat's memory, so a context case would
        // pass without ever proving it remembered anything within one
        // conversation.
        const runs = [];
        for (let i = 0; i < repeat; i += 1) {
          const freshContext = i === 0 ? null : await browser.newContext();
          const runPage = freshContext ? await freshContext.newPage() : page;
          try {
            runs.push(await runConversation(runPage, c.prompts));
          } finally {
            if (freshContext) await freshContext.close();
          }
          // Space out repeats for the same reason tests are spaced out.
          if (i < repeat - 1) {
            await page.waitForTimeout(config.timing.interSessionDelayMs).catch(() => {});
          }
        }

        // The scored reply is the last one of each run. Judge the case on its
        // WORST run — otherwise a bot that answers correctly most of the time
        // would pass a consistency case.
        const replies = runs.map((r) => r.exchanges[r.exchanges.length - 1].response);
        const perRun = [];
        for (const r of runs) {
          const reply = r.exchanges[r.exchanges.length - 1].response;
          perRun.push(
            await semanticScorer.validate({
              response: reply,
              reference: c.reference,
              expectedKeywords: c.expectedKeywords,
              checkGrounding: c.checkGrounding,
              clarificationExpected: c.clarificationExpected,
              context: contextFrom(r.exchanges, c.contextTurns),
            }),
          );
        }
        let worstIdx = 0;
        perRun.forEach((r, i) => {
          if (r.score < perRun[worstIdx].score) worstIdx = i;
        });

        // Full report card: every validator scores this case, so the report
        // shows all dimensions even though only some are asserted below.
        const turn = {
          scenario: c.name,
          prompt: c.prompts.join('  |  '),
          response: replies[worstIdx],
          responses: replies,
          reference: c.reference,
          expectedKeywords: c.expectedKeywords,
          allowList: c.safety?.allowList,
          checkGrounding: c.checkGrounding,
          clarificationExpected: c.clarificationExpected,
          context: contextFrom(runs[worstIdx].exchanges, c.contextTurns),
          latenciesMs: runs.flatMap((r) => r.latenciesMs),
        };
        const report = await engines.get(suite).evaluate(turn);
        const byName = (name) => report.validators.find((v) => v.name === name);
        const semantic = byName('Semantic Correctness');
        const consistency = byName('Consistency');
        const latency = byName('Latency');
        const safety = byName('Sensitive Info Leakage');

        logger.info(`\n── ${suite} :: ${c.name} ──`);
        logger.info(`prompt(s): ${c.prompts.join('  |  ')}`);
        replies.forEach((r, i) => logger.info(`reply${repeat > 1 ? ` [run ${i + 1}]` : '    '}: ${r}`));

        // Persist before asserting: a failing assertion ends the test (and the
        // worker), so anything held only in memory at this point would be lost.
        store.save(currentKey, {
          suite,
          case: c.name,
          prompts: c.prompts,
          reply: replies[worstIdx],
          replies: repeat > 1 ? replies : undefined,
          scores: repeat > 1 ? perRun.map((r) => r.score) : undefined,
          ...report,
        });

        // --- assertions: only the dimension this suite is about ---

        if (c.expect?.min != null) {
          checkOrWarn(c.soft, `min ${c.expect.min}`, () =>
            expect(semantic.score, `${c.name}: score below min`).toBeGreaterThanOrEqual(c.expect.min));
        }
        if (c.expect?.max != null) {
          checkOrWarn(c.soft, `max ${c.expect.max}`, () =>
            expect(semantic.score, `${c.name}: score above max`).toBeLessThanOrEqual(c.expect.max));
        }

        for (const [key, want] of Object.entries(c.signals || {})) {
          checkOrWarn(c.soft, `signal ${key}==${want}`, () =>
            expect(semantic.details[key], `${c.name}: signal ${key}`).toBe(want));
        }

        // Reply similarity across repeats. Best-effort by default: it measures
        // phrasing stability, while correctness is already gated above.
        if (repeat > 1 && c.consistency?.min != null) {
          checkOrWarn(c.consistency.soft ?? true, `consistency ${c.consistency.min}`, () =>
            expect(consistency.score, `${c.name}: replies varied across repeats`)
              .toBeGreaterThanOrEqual(c.consistency.min));
        }

        if (c.latency?.maxMs != null) {
          checkOrWarn(c.latency.soft ?? true, `latency <= ${c.latency.maxMs}ms`, () =>
            expect(latency.details.averageMs, `${c.name}: too slow`)
              .toBeLessThanOrEqual(c.latency.maxMs));
        }

        if (c.safety) {
          checkOrWarn(c.safety.soft ?? false, 'no sensitive data leaked', () =>
            expect(safety.details.leaked, `${c.name}: sensitive data in reply`).toBe(false));
        }

        // Context cases: prove the prior turn actually helped.
        if (c.contextTurns > 0) {
          const withoutContext = await semanticScorer.validate({ ...turn, context: [] });
          logger.info(`context lift: with=${semantic.score} without=${withoutContext.score}`);
          // Informational only: merging context into the reference can dilute
          // lexical similarity, so this is logged rather than asserted.
          checkOrWarn(true, 'context lift', () =>
            expect(semantic.score, `${c.name}: context did not help`)
              .toBeGreaterThanOrEqual(withoutContext.score));
        }
      });
    }
  });
}

test.afterEach(async ({ page }, testInfo) => {
  // Runs even when the test failed, so this is where the outcome is recorded.
  if (currentKey) {
    store.patch(currentKey, {
      ...currentMeta,
      status: testInfo.status,
      error: testInfo.error ? testInfo.error.message.split('\n')[0] : undefined,
      warnings,
    });
    currentKey = null;
    currentMeta = null;
  }
  // Space out sessions to reduce the chance of LiveChat throttling.
  await page.waitForTimeout(config.timing.interSessionDelayMs).catch(() => {});
});

test.afterAll(() => {
  // Rebuilt from disk, so results stored by a worker that was later discarded
  // are still included.
  const order = suites.flatMap((s) => s.cases.map((c) => `${s.suite}/${c.name}`));
  const reports = store.loadAll(order);
  if (!reports.length) return;

  // Count each case by its own verdict, not by the blended score — a Safety case
  // that leaked nothing is a pass even if the bot answered slowly.
  const verdictOf = (r) => r.status || (r.passed ? 'passed' : 'failed');
  const passed = reports.filter((r) => verdictOf(r) === 'passed').length;
  const skipped = reports.filter((r) => verdictOf(r) === 'skipped').length;
  const summary = {
    generatedAt: new Date().toISOString(),
    totalCases: reports.length,
    passed,
    skipped,
    failed: reports.length - passed - skipped,
    averageOverallScore: Number(
      (reports.reduce((s, r) => s + (r.overallScore || 0), 0) / reports.length).toFixed(4),
    ),
    suites: suites.map((s) => s.suite),
    reports,
  };

  const outDir = path.join(__dirname, '..', 'reports');
  fs.mkdirSync(outDir, { recursive: true });
  const jsonFile = path.join(outDir, 'evaluation-report.json');
  fs.writeFileSync(jsonFile, JSON.stringify(summary, null, 2));
  const htmlFile = path.join(outDir, 'evaluation-report.html');
  fs.writeFileSync(htmlFile, renderHtmlReport(summary));
  logger.info(`Evaluation report written to ${jsonFile}`);
  logger.info(`HTML report written to ${htmlFile}`);
  logger.score(`SUITES: ${passed}/${reports.length} cases passed, avg ${summary.averageOverallScore}`);
});
