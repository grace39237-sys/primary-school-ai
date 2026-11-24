// words.js — direct word lookup for Ask mode (v2.1).
// A single word (or two-word phrase) is answered straight from the
// curriculum word list (data/words.json) — no model, no retrieval —
// because a bare word embeds too poorly to clear the refusal threshold.
//
// All text comes from the books (class words, lesson keywords, quiz
// "What is a/an/the X?" explanations). Nothing is invented. A miss
// returns null and the normal RAG flow takes over.
let words = null;
let wordsLoading = null;

export async function loadWords() {
  if (words) return words;
  if (!wordsLoading) {
    wordsLoading = fetch('./data/words.json')
      .then((r) => { if (!r.ok) throw new Error(`words.json ${r.status}`); return r.json(); })
      .then((d) => { words = d; return words; })
      .catch((e) => { wordsLoading = null; throw e; });
  }
  return wordsLoading;
}

function normQuery(q) {
  return String(q || '').trim().toLowerCase()
    .replace(/[?!.]+$/, '')
    .replace(/-/g, ' ')
    .replace(/\s+/g, ' ');
}

// Returns the word entry for a 1–2 word query, or null. Exact match
// first; a trailing 's'/'es' is stripped once for simple plurals
// ("nouns" → "noun", "boxes" → "box").
export function lookupWord(q, dict) {
  const key = normQuery(q);
  if (!key) return null;
  if (!/^[a-z][a-z ]*$/.test(key)) return null;
  if (key.split(' ').length > 2) return null;
  const d = dict || words;
  if (!d) return null;
  if (d[key]) return d[key];
  if (key.endsWith('es') && d[key.slice(0, -2)]) return d[key.slice(0, -2)];
  if (key.endsWith('s') && d[key.slice(0, -1)]) return d[key.slice(0, -1)];
  return null;
}
