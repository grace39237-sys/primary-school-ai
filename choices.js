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
import { singularize } from './textutil.js';

export const DIRECT_THRESHOLD = 0.67;
export const REFUSAL_THRESHOLD = 0.40;

// score -> 'direct' | 'choices' | 'refuse'
export function classifyBand(score) {
  if (typeof score !== 'number' || Number.isNaN(score)) return 'refuse';
  if (score >= DIRECT_THRESHOLD) return 'direct';
  if (score >= REFUSAL_THRESHOLD) return 'choices';
  return 'refuse';
}

// Grade-first fallback (v2.4): the grade's own hits are used only when the
// best one clears the refusal threshold — otherwise the caller falls back
// to the all-grades search, so a question taught in another grade still
// gets an answer instead of a refusal. Hits arrive best-first.
export function gradeHitsUsable(hits) {
  return !!(hits && hits.length && hits[0].score >= REFUSAL_THRESHOLD);
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

// Dedup key for a choice label: lowercase, punctuation -> space,
// whitespace collapsed, articles dropped, trailing "s" singularized
// on the last word, spaces stripped. Two labels that mean the same
// thing for a child ("What falls from the cloud?" vs "What falls from
// clouds?") collapse to one choice so the next distinct chunk fills
// the slot. The v2.2 key only stripped punctuation, so the cloud/clouds
// pair slipped through as two of the three choices.
export function dedupKey(label) {
  const words = String(label || '').trim().toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim()
    .split(' ').filter((w) => w && w !== 'the' && w !== 'a' && w !== 'an');
  if (words.length) words[words.length - 1] = singularize(words[words.length - 1]);
  return words.join('');
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
    const key = dedupKey(label);
    if (!key || seen.has(key)) continue;
    // Same chunk twice (same id) is the same choice too.
    if (seen.has(`id:${h.chunk.id}`)) continue;
    seen.add(key);
    seen.add(`id:${h.chunk.id}`);
    out.push({ chunk: h.chunk, label, score: h.score });
  }
  return out;
}

// 'More' on the answer card (v2.4): the other top hits from the same Ask,
// so the child can explore further. The chunk just answered is excluded
// (by id, and by object identity when the chunk has no id); at most n
// hits, in score order. Pure — shared by app.js and the Node test.
export function relatedHits(hits, answeredChunk, n = 3) {
  const answeredId = answeredChunk && answeredChunk.id;
  const out = [];
  for (const h of hits || []) {
    if (out.length >= n) break;
    if (!h || !h.chunk) continue;
    if (answeredId != null && h.chunk.id === answeredId) continue;
    if (answeredChunk && h.chunk === answeredChunk) continue;
    out.push(h);
  }
  return out;
}
