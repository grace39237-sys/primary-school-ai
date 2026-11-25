// oxford.js — Oxford Plus word list for Practice (v2.5).
// The 7,088-word list (20 levels, every word with a definition +
// example) lives in data/oxford_words.json, a compact copy of the
// vocabulary site's Oxford Plus data — built by work/build_oxford.mjs.
// Loaded on demand when the child picks Grade Oxford; the service
// worker caches it on first fetch like the quiz files, so Practice
// stays fully offline afterwards.
let oxford = null;
let oxfordLoading = null;

export async function loadOxfordWords() {
  if (oxford) return oxford;
  if (!oxfordLoading) {
    oxfordLoading = fetch('./data/oxford_words.json')
      .then((r) => { if (!r.ok) throw new Error(`oxford_words.json ${r.status}`); return r.json(); })
      .then((d) => { oxford = d; return oxford; })
      .catch((e) => { oxfordLoading = null; throw e; });
  }
  return oxfordLoading;
}
