/**
 * Deterministic, offline signals for grading semantic correctness beyond raw
 * lexical overlap. No dependencies, no network — every function is pure and
 * returns either a number in [0,1] or a small structured verdict.
 */
const { tokenize, cosineSimilarity, normalize } = require('./textSimilarity');

/**
 * Domain synonym groups. Each token maps to the group's canonical word so that
 * paraphrases ("assist" ~ "help", "price" ~ "cost") are treated as equivalent.
 */
const SYNONYM_GROUPS = [
  ['help', 'assist', 'assistance', 'support', 'aid', 'helping'],
  ['cost', 'price', 'pricing', 'priced', 'fee', 'fees', 'charge', 'charges', 'rate'],
  ['chatbot', 'bot', 'assistant', 'chatbots', 'agent'],
  ['customer', 'client', 'clients', 'customers', 'user', 'users', 'visitor', 'visitors', 'people'],
  ['automate', 'automates', 'automation', 'automated', 'automating'],
  ['question', 'questions', 'query', 'queries', 'faq', 'faqs', 'inquiry', 'inquiries'],
  ['answer', 'answers', 'reply', 'replies', 'respond', 'responds', 'response', 'responses'],
  ['buy', 'purchase', 'purchases', 'subscribe', 'subscription'],
  ['refund', 'refunds', 'reimbursement', 'reimburse'],
  ['cancel', 'cancellation', 'cancelling', 'canceling'],
  ['free', 'complimentary', 'zero', 'nothing', 'gratis'],
  ['month', 'monthly'],
  ['year', 'yearly', 'annually', 'annual'],
  ['feature', 'features', 'capability', 'capabilities', 'functionality'],
  ['language', 'languages', 'multilingual'],
  ['integrate', 'integration', 'integrations', 'connect', 'connects'],
  ['available', 'offer', 'offers', 'offering', 'provide', 'provides', 'provided'],
  ['round-the-clock', 'always', 'anytime'],
];

const CANON = (() => {
  const map = new Map();
  for (const group of SYNONYM_GROUPS) {
    const canonical = group[0];
    for (const word of group) map.set(word, canonical);
  }
  return map;
})();

/** Replace each token with its synonym-group canonical form. */
function canonicalize(text) {
  return tokenize(text).map((t) => CANON.get(t) || t).join(' ');
}

/**
 * Overlap coefficient over token sets: |A ∩ B| / min(|A|, |B|).
 * Unlike Jaccard, it is robust to length asymmetry — a short reference whose
 * concepts are all present in a long reply scores high (ideal for paraphrase).
 */
function overlapCoefficient(a, b) {
  const A = new Set(a.split(' ').filter(Boolean));
  const B = new Set(b.split(' ').filter(Boolean));
  if (!A.size || !B.size) return A.size === B.size ? 1 : 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter += 1;
  return inter / Math.min(A.size, B.size);
}

/**
 * Synonym-aware similarity over canonicalized text: blends cosine (word-vector
 * angle) with the length-robust overlap coefficient, so paraphrases with very
 * different lengths are still recognized as semantically close.
 */
function semanticSimilarity(a, b) {
  const ca = canonicalize(a);
  const cb = canonicalize(b);
  return 0.5 * cosineSimilarity(ca, cb) + 0.5 * overlapCoefficient(ca, cb);
}

/** Extract monetary amounts. "free"/"no cost"/"nothing" normalize to 0. */
function extractAmounts(text) {
  const amounts = new Set();
  const t = normalize(text);
  const money = text.match(/\$\s?(\d+(?:\.\d+)?)/g) || [];
  for (const m of money) amounts.add(Number(m.replace(/[^\d.]/g, '')));
  const plain = t.match(/\b(\d+(?:\.\d+)?)\s*(?:dollars|usd|per user|per month|\/mo|a month)\b/g) || [];
  for (const m of plain) amounts.add(Number(m.replace(/[^\d.]/g, '')));
  if (/\b(free|no cost|no charge|nothing|zero|complimentary)\b/.test(t)) amounts.add(0);
  return amounts;
}

// Antonym pairs: presence of one in the reference and the other in the reply
// signals a factual conflict.
const ANTONYMS = [
  ['free', 'paid'],
  ['available', 'unavailable'],
  ['yes', 'no'],
  ['included', 'excluded'],
  ['supported', 'unsupported'],
];

/**
 * Detect whether `response` contradicts `reference`.
 * @returns {{ contradicted: boolean, reasons: string[] }}
 */
function detectContradiction(response, reference) {
  const reasons = [];
  if (!response || !reference) return { contradicted: false, reasons };

  // 1) Numeric/price conflict: both sides state amounts, none in common.
  const refAmt = extractAmounts(reference);
  const resAmt = extractAmounts(response);
  if (refAmt.size && resAmt.size) {
    const shared = [...refAmt].some((a) => resAmt.has(a));
    if (!shared) reasons.push(`amount conflict: reference {${[...refAmt]}} vs reply {${[...resAmt]}}`);
  }

  // 2) Antonym conflict.
  const refN = normalize(reference);
  const resN = normalize(response);
  for (const [x, y] of ANTONYMS) {
    if ((refN.includes(x) && resN.includes(y)) || (refN.includes(y) && resN.includes(x))) {
      reasons.push(`antonym conflict: "${x}" vs "${y}"`);
    }
  }

  // Note: a generic "negation XOR + shared token" polarity rule was intentionally
  // dropped — it produced false positives (e.g. any reply containing "not" that
  // shared a noun with the reference). Contradiction relies on the stronger
  // amount- and antonym-conflict signals above.

  return { contradicted: reasons.length > 0, reasons };
}

/**
 * Grounding: fraction of the reply's specific claims (numbers + salient content
 * words) that are supported by `sourceText` (reference + any context). A reply
 * that invents unsupported specifics scores low; one with nothing specific to
 * verify scores 1.
 * @returns {{ score: number, unsupported: string[] }}
 */
function grounding(response, sourceText) {
  const source = new Set(canonicalize(sourceText).split(' ').filter(Boolean));
  const sourceNums = new Set((sourceText.match(/\d+(?:\.\d+)?/g) || []));

  const words = canonicalize(response).split(' ').filter((w) => w.length > 3);
  const nums = response.match(/\d+(?:\.\d+)?/g) || [];
  const specifics = [...new Set([...words, ...nums])];
  if (!specifics.length) return { score: 1, unsupported: [] };

  const unsupported = specifics.filter((s) =>
    /^\d/.test(s) ? !sourceNums.has(s) : !source.has(s),
  );
  const score = 1 - unsupported.length / specifics.length;
  return { score: Math.max(0, Math.min(1, score)), unsupported };
}

const CLARIFY_CUES =
  /(could you (please )?(clarify|specify|elaborate|tell me)|can you (please )?(clarify|specify|tell me)|which (plan|product|one|service|of)|what (do|did) you mean|what exactly|are you (referring|asking)|do you mean|please (clarify|specify|provide)|to clarify|more (details|information|context))/i;

/**
 * Whether the reply asks the user what they meant — the hallmark of handling an
 * ambiguous prompt.
 *
 * A bare question mark does NOT qualify. This bot ends most replies with a
 * pleasantry ("How can we assist you further today?"), and the old rule counted
 * any '?' anywhere, so a reply that confidently guessed and then signed off with
 * a courtesy question was indistinguishable from one that actually asked which
 * thing the user meant. The reply has to ask.
 */
function detectClarification(response) {
  return CLARIFY_CUES.test(String(response || ''));
}

module.exports = {
  canonicalize,
  semanticSimilarity,
  extractAmounts,
  detectContradiction,
  grounding,
  detectClarification,
};
