// choices.js — pure helpers for the Ask "3 choices" flow (v2.2, Won 2026-11-24).
// No browser APIs here: no DOM, no localStorage, no fetch — shared by
// app.js and the Node verification script (work/test_v2_2.mjs).
//
// Bands (Won's numbers): best retrieval score >= 0.67 → answer directly.
// 0.40–0.67 → the question is unclear: show 3 choices from the retrieved
// chunks and let the student pick one. Below 0.40 → refuse without
// calling the model. The 3-choice step is the safeguard for the lowered
// threshold: an off-topic question that lands above 0.40 still has to
// survive the child's own pick.

export const DIRECT_THRESHOLD = 0.67;
export const REFUSAL_THRESHOLD = 0.40;

// score -> 'direct' | 'choices' | 'refuse'
export function classifyBand(score) {
  if (typeof score !== 'number' || Number.isNaN(score)) return 'refuse';
  if (score >= DIRECT_THRESHOLD) return 'direct';
  if (score >= REFUSAL_THRESHOLD) return 'choices';
  return 'refuse';
}

function normLabel(s) {
  return String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

// Cap a label at 90 chars, cutting at a word boundary with an ellipsis
// so a choice never ends mid-word.
function cap(s) {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  if (t.length <= 90) return t;
  return `${t.slice(0, 87).replace(/\s+\S*$/, '')}…`;
}

// Grounded label for one chunk — only the chunk's own text is used, never
// invented wording. Lesson-qa and quiz chunks carry their own question
// ("Q: ... A: ..."); word chunks carry the word; lesson chunks carry the
// unit title. Labels are capped so a choice button stays readable.
export function choiceLabel(chunk) {
  const text = (chunk && chunk.text) || '';
  const q = text.match(/^Q:\s*(.+?)\s*A:/s);
  // Keep the question's own capitalisation — it is shown on the button.
  if (q && normLabel(q[1])) return cap(q[1]);
  if (chunk && chunk.kind === 'word') {
    const word = text.split(':')[0].trim();
    if (word) return cap(word);
  }
  if (chunk && chunk.unit) return cap(chunk.unit);
  const src = (chunk && chunk.source) || '';
  return cap(src) || 'From the book';
}

// Pick up to n distinct choices from retrieval hits (score order). Two
// chunks with the same label (same question/topic) count as one choice;
// the next distinct hit fills the slot. Returns [{ chunk, label, score }].
export function distinctChoices(hits, n = 3) {
  const seen = new Set();
  const out = [];
  for (const h of hits || []) {
    if (out.length >= n) break;
    if (!h || !h.chunk) continue;
    const label = choiceLabel(h.chunk);
    // The dedup key ignores punctuation and blanks: two choices that
    // differ only in "____." vs "___." are the same choice for a child.
    const key = normLabel(label).replace(/[^a-z0-9]/g, '');
    if (!key || seen.has(key)) continue;
    // Same chunk twice (same id) is the same choice too.
    if (seen.has(`id:${h.chunk.id}`)) continue;
    seen.add(key);
    seen.add(`id:${h.chunk.id}`);
    out.push({ chunk: h.chunk, label, score: h.score });
  }
  return out;
}
