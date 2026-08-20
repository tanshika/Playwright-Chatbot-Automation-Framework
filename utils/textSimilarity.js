/**
 * Lightweight text-similarity utilities.
 *
 * These are dependency-free heuristics used by the Semantic Correctness and
 * Consistency validators. They are deliberately simple and deterministic so the
 * framework runs without any external LLM/API. The validators expose a hook to
 * swap in a model-based scorer later if desired.
 */

const STOP_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'if', 'then', 'is', 'are', 'was',
  'were', 'be', 'been', 'to', 'of', 'in', 'on', 'for', 'with', 'at', 'by',
  'from', 'as', 'it', 'this', 'that', 'these', 'those', 'i', 'you', 'we',
  'they', 'he', 'she', 'do', 'does', 'did', 'can', 'will', 'your', 'our',
]);

/** Normalize: lowercase, strip punctuation, collapse whitespace. */
function normalize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Tokenize into meaningful words (stop words removed by default). */
function tokenize(text, { keepStopWords = false } = {}) {
  const words = normalize(text).split(' ').filter(Boolean);
  return keepStopWords ? words : words.filter((w) => !STOP_WORDS.has(w));
}

/**
 * Jaccard similarity over token sets: |A ∩ B| / |A ∪ B|.
 * Returns a value in [0, 1].
 */
function jaccardSimilarity(a, b) {
  const setA = new Set(tokenize(a));
  const setB = new Set(tokenize(b));
  if (setA.size === 0 && setB.size === 0) return 1;
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  for (const t of setA) if (setB.has(t)) intersection += 1;
  const union = setA.size + setB.size - intersection;
  return intersection / union;
}

/**
 * Cosine similarity over term-frequency vectors. Captures repeated-word weight
 * better than Jaccard. Returns a value in [0, 1].
 */
function cosineSimilarity(a, b) {
  const tfA = termFreq(tokenize(a));
  const tfB = termFreq(tokenize(b));
  const keys = new Set([...tfA.keys(), ...tfB.keys()]);
  if (keys.size === 0) return 1;
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (const k of keys) {
    const x = tfA.get(k) || 0;
    const y = tfB.get(k) || 0;
    dot += x * y;
    magA += x * x;
    magB += y * y;
  }
  if (magA === 0 || magB === 0) return 0;
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

function termFreq(tokens) {
  const map = new Map();
  for (const t of tokens) map.set(t, (map.get(t) || 0) + 1);
  return map;
}

/**
 * Fraction of `keywords` that appear (as whole tokens) in `text`.
 * Returns a value in [0, 1]. Empty keyword list scores 1 (nothing required).
 *
 * An entry may be a nested array of alternatives, satisfied by any one member:
 * `[['help', 'assist'], 'pricing']` is two requirements, not three.
 */
function keywordCoverage(text, keywords = []) {
  if (!keywords.length) return 1;
  const tokens = new Set(tokenize(text, { keepStopWords: true }));
  const haystack = normalize(text);

  const matches = (kw) => {
    const norm = normalize(kw);
    if (!norm) return false;
    // Multi-word keyword => substring match; single word => token match.
    return norm.includes(' ') ? haystack.includes(norm) : tokens.has(norm);
  };

  let hits = 0;
  for (const entry of keywords) {
    // Synonyms belong in one group: listed flat they count as separate facts, so
    // a reply is penalised for the wording it happened not to use.
    hits += (Array.isArray(entry) ? entry.some(matches) : matches(entry)) ? 1 : 0;
  }
  return hits / keywords.length;
}

/**
 * Blended semantic similarity combining lexical-overlap signals.
 * Returns a value in [0, 1].
 */
function blendedSimilarity(a, b) {
  return 0.5 * cosineSimilarity(a, b) + 0.5 * jaccardSimilarity(a, b);
}

module.exports = {
  normalize,
  tokenize,
  jaccardSimilarity,
  cosineSimilarity,
  keywordCoverage,
  blendedSimilarity,
};
