# Playwright Chatbot Automation Framework

Playwright + JavaScript framework that evaluates a **live chatbot's answer
quality**, not just its UI — semantic correctness, relevance, completeness,
hallucination, consistency, safety and latency — with deterministic,
dependency-free scoring and an HTML scorecard.

Most chatbot automation asserts that a widget opens and some text appears. This
framework asks a harder question: **was the answer any good?** It drives the real
widget through a **Page Object Model**, then scores each reply with pluggable
**validators** — keyword coverage, synonym-aware similarity, grounding,
contradiction and clarification detection, PII scanning, response time.

Scoring is **heuristic and offline**: no LLM, no API key, no per-run cost, and the
same reply always produces the same score. That makes a failing case
reproducible and debuggable, which an LLM-as-judge setup is not.

Target under test: the LiveChat AI-assistant widget embedded on
<https://www.chatbot.com/help/chat-widget/sample-page/>.

```bash
npm install && npx playwright install chromium
npm test                 # 12 live quality cases across 7 suites + 4 offline guards
open reports/evaluation-report.html
```

![Chatbot evaluation report: a suite-grouped scorecard. A summary bar shows 12 cases, 12 passed, 0 failed, 0.707 average. Below it the Semantic Correctness suite lists three cases, each a card with a PASS badge, the prompt, and a table of validator scores with coloured bars.](docs/report-screenshot.png)

Each case carries a PASS/FAIL badge from **its own assertions**, then every
validator's score. Dimensions the suite does not assert on are marked *not
counted*. That is why `contradictory-answer` passes at 0.250 — it asserts a
*maximum*, so a low score is the case succeeding, not failing.

### Two things to know before you run it

- **It runs headed.** LiveChat's widget refuses to mount in headless Chromium
  (bot detection), so the browser is visible by default. In CI, wrap it:
  `xvfb-run -a npm test`. `HEADLESS=true` exists but will not work against this
  widget.
- **The bot is a third-party demo**, not something this repo controls. Its
  wording drifts between runs and heavy traffic can trip LiveChat's throttling,
  so most cases are `soft` — they log a warning instead of failing the build.
  Real invariants ("no PII in the reply") stay hard failures.

## Validators

| Validator | Question it answers | Scoring |
|-----------|--------------------|---------|
| **Semantic Correctness** | Is the reply a correct answer? | Blend of required-keyword coverage and similarity to a reference answer. |
| **Sensitive Info Leakage** | Did the bot expose PII/secrets? | Inverse score: starts at 1.0, each finding (email, phone, card, SSN, API key, …) subtracts a severity weight. |
| **Consistency** | Same answer when asked repeatedly? | Average pairwise similarity across repeated replies. |
| **Latency** | Was the reply fast enough? | Response time mapped to 0–1 between `goodMs` (1.0) and `badMs` (0.0). |

Overall score = `Σ(score × weight) / Σweight`, but **weights are per suite**, so a
case is blended only over the dimensions it actually asserts on:

| Suite | Counted |
|-------|---------|
| Semantic Correctness, Relevance, Completeness, Hallucination | semantic 1.0 |
| Consistency | consistency 0.5, semantic 0.5 |
| Safety | leakage 0.75, semantic 0.25 |
| Latency / Performance | latency 0.75, semantic 0.25 |

Dimensions a suite omits are still measured and shown on the report card, marked
**not counted**. Without this a Semantic Correctness case was dragged down by
latency it never claimed to test, and every single-message case collected a free
1.0 from Consistency — which returns "nothing to compare" rather than a
measurement. Declare `weights` in the suite file; suites that omit it fall back to
the global defaults in `config/framework.config.js`.

Note the blended score is reporting only — **nothing asserts on it**. Each case
passes or fails on its own assertions (`expect`, `signals`, `consistency`,
`latency`, `safety`), which is what the PASS/FAIL badge reflects. Some cases are
*supposed* to score low: `contradictory-answer` asserts `max 0.4`, so its 0.25 is
the case succeeding.

## Test suites

Cases are organised by the **quality dimension** they measure. Every case is
scored by *all* validators, so each one gets a full report card — but a case only
**asserts** on the dimension its suite is about. A Latency case is not failed for
wording, and a Semantic Correctness case is not failed for being slow.

| Suite | Asks | Cases |
|-------|------|-------|
| **Semantic Correctness** | Does the reply mean the right thing? | correct-answer, correct-meaning-different-wording, contradictory-answer |
| **Relevance** | Does it address what was actually asked? | ambiguous-question, follow-up-context, ask-for-help |
| **Completeness** | Does it cover every part of the question? | partial-answer |
| **Hallucination** | Does it invent facts? | hallucinated-information |
| **Consistency** | Same answer every time; does context survive? | consistent-conversation-context, pricing-consistency |
| **Safety** | Does it leak PII or secrets? | contact-info-leakage-probe |
| **Latency / Performance** | Does it answer within budget? | greeting-response-time |

Run one suite at a time with `npm run test:semantic`, `test:relevance`,
`test:completeness`, `test:hallucination`, `test:consistency`, `test:safety`,
`test:latency`.

Each case declares only the assertions its suite needs (`expect` band, `signals`,
`consistency`, `latency`, `safety`); `soft: true` downgrades a failure to a
logged warning, which most live-bot cases use. The full schema is documented at
the top of `data/suites/index.js`.

## Architecture

```
config/framework.config.js   Single source of truth: URLs, selectors, timings,
                             weights, thresholds. Selectors are candidate lists.

pages/                       Page Object Model
  BasePage.js                Shared helpers (navigation, resilient locators).
  ChatBotPage.js             Drives the widget: open(), sendMessage(),
                             askAndMeasure() -> { response, latencyMs, settled }.
                             `settled: false` means the reply stopped being
                             readable before it stopped changing — the text may
                             be truncated and the latency is not a completion
                             time. Surfaced as a warning in the report.

validators/                  One file per validator, all extending BaseValidator
  BaseValidator.js           Common contract -> { name, score, weight, passed, details }.
  SemanticCorrectnessValidator.js
  SensitiveInfoValidator.js
  ConsistencyValidator.js
  LatencyValidator.js
  EvaluationEngine.js        Runs all validators, blends scores into an overall report.

utils/
  textSimilarity.js          Dependency-free similarity (cosine/Jaccard/keyword).
  semanticSignals.js         Contradiction, grounding, clarification detection.
  htmlReport.js              Renders the suite-grouped HTML scorecard.
  resultStore.js             Crash-safe per-case result persistence (see below).
  logger.js                  Leveled, prefixed logging.

data/suites/                 One file per quality dimension; index.js registers
  index.js                   them in order and documents the case schema.
  semanticCorrectness.js relevance.js completeness.js
  hallucination.js consistency.js safety.js latency.js

tests/qualitySuites.spec.js  Single runner: one describe block per suite, every
                             case scored by all validators, asserting only on its
                             own dimension. Writes both reports.

tests/extractor.spec.js      Deterministic guards for the DOM reading rules, run
                             against synthetic markup — no network, ~1s. Each case
                             maps to a bug that silently lost message content.

scripts/inspect.js           Dev utility to inspect the live widget's DOM.
```

### Crash-safe reporting

Playwright discards a worker process as soon as a test fails and starts a fresh
one, so results a spec accumulates in memory are lost — and the lost result is
always a *failing* one, i.e. exactly the case worth reporting. `ResultStore`
writes each case to its own file under `reports/.parts/` the moment it is scored,
then stitches them back together at the end of the run.

The layering keeps concerns separated: **tests** describe *what* to check,
**page objects** know *how* to talk to the widget, **validators** know *how to
score*, and **config/data** hold everything that changes often.

## Setup

```bash
npm install
npx playwright install chromium
```

## Running

```bash
npm test              # run every suite, print scores, write reports/
npm run test:extractor # fast offline DOM-reading guards (no live bot, ~1s)
npm run test:headed   # same (already headed by default) with visible browser
npm run report:html   # regenerate the human-readable HTML report from the JSON
npm run report:screenshot  # refresh docs/report-screenshot.png used in this README
npm run report        # open the Playwright HTML report (traces/screenshots)
```

Outputs:
- `reports/evaluation-report.html` — **human-readable** scorecard, grouped by suite:
  a per-case card with color-coded validator score bars, best-effort warnings, and a
  PASS/FAIL badge reflecting the case's own assertions (not the blended score).
  Written automatically by `npm test`; regenerate from JSON with `npm run report:html`.
- `reports/evaluation-report.json` — machine-readable per-case validator scores, replies,
  status, and warnings + run summary.
- `reports/html/` — Playwright HTML report (traces/screenshots on failure).

### Important: the suite runs **headed**

LiveChat's widget refuses to mount in headless Chromium (bot detection), so the
framework runs with a visible browser by default. In CI, run it under a virtual
display, e.g. `xvfb-run -a npm test`. `HEADLESS=true npm test` is available but
will not work against this particular widget.

### Useful flags

| Env var | Effect |
|---------|--------|
| `LOG_LEVEL=debug`  | More verbose logging (`debug`/`info`/`warn`/`error`/`silent`). |

Whether a case fails hard or warns is now a property of the case (`soft`), not a
global switch — so a flaky live-bot expectation can be best-effort while a real
invariant like "no PII in the reply" stays a hard failure.

## Extending

**Add a case** — append to the suite file for the dimension it measures, e.g.
`data/suites/completeness.js`:

```js
{
  name: 'refund-policy',
  prompts: ['What is your refund policy?'],
  reference: 'Fees are non-refundable for the remainder of the subscription period.',
  expectedKeywords: ['refund', 'policy'],
  repeat: 2,                  // each repeat runs in a FRESH session
  expect: { min: 0.4 },       // band on the semantic score (worst run)
  // consistency: { min: 0.5 },  latency: { maxMs: 30000 },  safety: {},
  soft: true,                 // best-effort: log instead of fail
}
```

**Add a suite** — create `data/suites/<name>.js` exporting
`{ suite, description, cases }` and register it in `data/suites/index.js`. The
runner picks it up automatically.

**Add a validator** — extend `BaseValidator`, implement `async validate(turn)`
returning `this.buildResult(score, details)`, and register it in
`EvaluationEngine`'s constructor (with a weight).

**Swap in an LLM scorer** — `SemanticCorrectnessValidator` and
`ConsistencyValidator` accept `coverageFn`/`similarityFn` overrides, so the
heuristic text similarity can be replaced with model-based scoring without
changing the validator interface.

## Notes & tuning

- The bot is a **streaming AI**; full replies can take 15–30s. Latency thresholds
  (`config.latency.goodMs/badMs`) and `timing.botReplyTimeoutMs` are tuned for
  this. Adjust for a faster bot.
- Message reading relies on LiveChat's structure (bot = left-aligned, visitor =
  right-aligned, with noise filtering). If the widget markup changes, update
  `config.reading` and the selectors in `config.selectors` / `config.frames`.
  Use `node scripts/inspect.js` to re-discover the live DOM.
```
