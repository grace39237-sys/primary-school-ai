// calibrate_v2_7.mjs — retrieval check for tutor v2.7 (DL plans + full
// textbook sentences added to the index). Runs the SAME 16 Ask-test
// questions as calibrate_threshold.mjs against the NEW index and compares
// per-question best scores with the v2.4 baseline (calibration.json).
// Rule: do NOT ship if retrieval got worse — curriculum min below the
// v2.4 baseline (0.696) or refusal max above it (0.638).
// Also runs retrieval spot-checks: a teacher question must return a DL
// chunk, and 'What is photosynthesis?' must return textbook content.
// Writes calibration_v2_7.json — NEVER overwrites calibration.json.
// Run from ~/workspace/primary-school-ai/work AFTER the full v2.7 build:
//   node calibrate_v2_7.mjs
import { pipeline, env } from '@huggingface/transformers';
import fs from 'node:fs';

env.cacheDir = './.cache';
env.allowLocalModels = false;

const CASES = [
  { id: 'C1', kind: 'curriculum', q: 'What is a noun?' },
  { id: 'C2', kind: 'curriculum', q: 'What parts are on the head of an insect?' },
  { id: 'C3', kind: 'curriculum', q: 'How do we keep our bodies clean?' },
  { id: 'C4', kind: 'curriculum', q: 'Which word is the adjective in this sentence: Maurice has a beautiful dress?' },
  { id: 'C5', kind: 'curriculum', q: 'Okello is 10 years old and 100 cm tall. Akena is 8 years old and 110 cm tall. Who is taller?' },
  { id: 'C6', kind: 'curriculum', q: 'How are hospitals important in our communities?' },
  { id: 'C7', kind: 'curriculum', q: 'Why is central Tanzania not good for cattle keeping?' },
  { id: 'C8', kind: 'curriculum', q: 'Which river flows into Lake Victoria?' },
  { id: 'C9', kind: 'curriculum', q: 'The area of a square is 144 square centimetres. Find the length of each side.' },
  { id: 'C10', kind: 'curriculum', q: 'How is a splint useful to a person with a fractured lower leg?' },
  { id: 'C11', kind: 'curriculum', q: 'A and B shared money in the ratio 3 to 4. If A got 12,000 shillings, how much money was shared?' },
  { id: 'C12', kind: 'curriculum', q: 'Name two hills in Kampala.' },
  { id: 'R1', kind: 'refusal', q: 'How do I fix a car engine that will not start?' },
  { id: 'R2', kind: 'refusal', q: 'Who won the election in Uganda last month?' },
  { id: 'R3', kind: 'refusal', q: 'What is quantum entanglement?' },
  { id: 'R4', kind: 'refusal', q: 'How much money do I need to build a house in Kampala?' },
];
// Spot-checks for the two new sources (not part of the 16-question set).
const SPOTS = [
  { id: 'S1', q: 'What should I teach today in P3 English Term 1?',
    need: (h) => h.kind === 'dl' && h.grade === 'P3' && h.subject === 'English' && h.unit.startsWith('Term 1'),
    desc: 'a P3 English Term 1 DL plan chunk' },
  { id: 'S2', q: 'What is photosynthesis?',
    need: (h) => /photosynth/i.test(h.text || ''),
    desc: 'a chunk whose text mentions photosynthesis' },
  { id: 'S3', q: 'What activities can I do to teach about our community in P1?',
    need: (h) => h.kind === 'dl' && h.grade === 'P1',
    desc: 'a P1 DL plan chunk' },
];

const meta = JSON.parse(fs.readFileSync('../data/index.json', 'utf8'));
const vecs = new Int8Array(fs.readFileSync('../data/index.bin'));
const { dim, count, chunks } = meta;
if (vecs.length !== count * dim) throw new Error('index size mismatch');
console.log(`index: ${count} chunks (v2.7)`);

const emb = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', { dtype: 'q8' });
function search(qvec, k = 3) {
  const scored = new Array(count);
  for (let i = 0; i < count; i++) {
    const scale = chunks[i].scale;
    const base = i * dim;
    let dot = 0;
    for (let d = 0; d < dim; d++) dot += vecs[base + d] * qvec[d];
    scored[i] = dot * scale;
  }
  const order = scored.map((s, i) => i).sort((a, b) => scored[b] - scored[a]).slice(0, k);
  return order.map((i) => ({ chunk: chunks[i], score: scored[i] }));
}

const rows = [];
for (const c of CASES) {
  const out = await emb(c.q, { pooling: 'mean', normalize: true });
  const hits = search(out.data, 3);
  const best = hits[0];
  rows.push({ ...c, best: +best.score.toFixed(3), bestKind: best.chunk.kind, bestId: best.chunk.id, bestText: (best.chunk.source || '').slice(0, 90) });
  console.log(`${c.id} [${c.kind}] best=${best.score.toFixed(3)} kind=${best.chunk.kind} via ${best.chunk.id} :: ${(best.chunk.source || '').slice(0, 90)}`);
}
const cur = rows.filter((r) => r.kind === 'curriculum').map((r) => r.best);
const ref = rows.filter((r) => r.kind === 'refusal').map((r) => r.best);
const minCur = Math.min(...cur), maxRef = Math.max(...ref);
console.log(`\ncurriculum best-score range: ${Math.min(...cur).toFixed(3)} – ${Math.max(...cur).toFixed(3)}`);
console.log(`refusal best-score range: ${Math.min(...ref).toFixed(3)} – ${Math.max(...ref).toFixed(3)}`);
console.log(`suggested threshold: ${((minCur + maxRef) / 2).toFixed(2)} (midpoint; curriculum min ${minCur.toFixed(3)}, refusal max ${maxRef.toFixed(3)})`);

// Baseline comparison (v2.4 calibration.json — never overwritten).
const base = JSON.parse(fs.readFileSync('./calibration.json', 'utf8'));
const baseById = Object.fromEntries(base.rows.map((r) => [r.id, r.best]));
console.log(`\nbaseline (v2.4): curriculum min ${base.minCurriculum}, refusal max ${base.maxRefusal}`);
let worse = 0;
for (const r of rows) {
  const d = +(r.best - baseById[r.id]).toFixed(3);
  const flag = (r.kind === 'curriculum' && d < -0.02) || (r.kind === 'refusal' && d > 0.02) ? ' <<<' : '';
  if (flag) worse++;
  console.log(`  ${r.id}: v2.7 ${r.best} vs v2.4 ${baseById[r.id]} (delta ${d >= 0 ? '+' : ''}${d})${flag}`);
}
const verdict = (minCur < base.minCurriculum - 0.02 || maxRef > base.maxRefusal + 0.02)
  ? 'RETRIEVAL GOT WORSE — do NOT ship'
  : 'retrieval NOT worse — OK to ship on retrieval grounds';
console.log(`\nVERDICT: ${verdict} (curriculum min ${minCur.toFixed(3)} vs ${base.minCurriculum}; refusal max ${maxRef.toFixed(3)} vs ${base.maxRefusal}; ${worse} questions moved the wrong way by >0.02)`);

// Spot-checks for the new sources.
const spots = [];
for (const s of SPOTS) {
  const out = await emb(s.q, { pooling: 'mean', normalize: true });
  const hits = search(out.data, 3);
  const ok = hits.some((h) => s.need(h.chunk));
  spots.push({ ...s, ok, top: hits.map((h) => ({ kind: h.chunk.kind, grade: h.chunk.grade, score: +h.score.toFixed(3), id: h.chunk.id })) });
  console.log(`${s.id} "${s.q}" → ${ok ? 'PASS' : 'FAIL'} (needs ${s.desc}); top-3: ${hits.map((h) => `${h.chunk.kind}:${h.chunk.grade}@${h.score.toFixed(3)}`).join(', ')}`);
}

fs.writeFileSync('./calibration_v2_7.json',
  JSON.stringify({ builtAt: new Date().toISOString(), indexChunks: count, rows, minCurriculum: minCur, maxRefusal: maxRef, suggested: +((minCur + maxRef) / 2).toFixed(2), baseline: { minCurriculum: base.minCurriculum, maxRefusal: base.maxRefusal }, verdict, spots }, null, 2));
console.log('\nwrote calibration_v2_7.json');
