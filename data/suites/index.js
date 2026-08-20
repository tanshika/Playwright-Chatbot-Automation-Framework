/**
 * Test suites, organised by the quality dimension each one measures.
 *
 * Every case is exercised against the live bot and scored by ALL validators, so
 * each case gets a full report card. A case only *asserts* on the dimension its
 * suite is about — a Latency case is not failed for wording, and a Semantic
 * Correctness case is not failed for being slow.
 *
 * Suite fields:
 *   suite         display name, also the describe block and -g filter
 *   description   one line, logged when the suite starts
 *   weights       dimensions counted in the blended score, e.g.
 *                 { semanticCorrectness: 1 } or { latency: 0.75, semanticCorrectness: 0.25 }.
 *                 Omitted dimensions weigh 0: still measured and shown on the
 *                 report card, but marked "not counted". This keeps a case from
 *                 being scored on things it never claimed to test, and stops the
 *                 Consistency validator handing a free 1.0 ("nothing to compare")
 *                 to every case that sends a single message.
 *   cases         the cases, in run order
 *
 * Case schema:
 *   name                      kebab-case id, unique within the suite
 *   prompts: string[]         messages sent in order (the last reply is scored)
 *   repeat                    run the whole conversation N times, each in a
 *                             fresh session; bands then apply to the worst run
 *   reference                 reference answer (similarity/contradiction/grounding)
 *   expectedKeywords          required facts (keyword coverage). A nested array
 *                             is an alternatives group satisfied by any one
 *                             member — use it for synonyms, so the bot is not
 *                             scored on which wording it happened to pick:
 *                             [['help', 'assist', 'support'], 'pricing']
 *   contextTurns              leading exchanges fed to the scorer as context
 *   checkGrounding            apply the grounding (anti-hallucination) signal
 *   clarificationExpected     treat a clarifying question as the correct answer
 *
 * Assertions (each optional — declare only what the suite is about):
 *   expect: { min?, max? }       band on the Semantic Correctness score
 *   signals: { ... }             exact-match assertions on semantic details
 *   consistency: { min, soft? }  band on reply similarity across repeats
 *   latency: { maxMs, soft? }    ceiling on average response time
 *   safety: { allowList?, soft? } require no sensitive-data leakage
 *   soft                         true => best-effort (logged, non-fatal)
 */
module.exports = [
  require('./semanticCorrectness'),
  require('./relevance'),
  require('./completeness'),
  require('./hallucination'),
  require('./consistency'),
  require('./safety'),
  require('./latency'),
];
