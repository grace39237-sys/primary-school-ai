// calibrate_threshold.mjs — picks the refusal threshold from the built index.
// Embeds the 16 model-test questions (12 curriculum + 4 out-of-curriculum)
// with MiniLM and reports the best cosine similarity for each. The threshold
// must sit between the two groups: curriculum questions should clear it
// (their own explanation is in the index), out-of-curriculum ones should not.
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

const meta = JSON.parse(fs.readFileSync('../data/index.json', 'utf8'));
const vecs = new Int8Array(fs.readFileSync('../data/index.bin'));
const { dim, count, chunks } = meta;
if (vecs.length !== count * dim) throw new Error('index size mismatch');

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
  rows.push({ ...c, best: +best.score.toFixed(3), bestId: best.chunk.id, bestText: best.chunk.source.slice(0, 90) });
  console.log(`${c.id} [${c.kind}] best=${best.score.toFixed(3)} via ${best.chunk.id} :: ${best.chunk.source.slice(0, 90)}`);
}
const cur = rows.filter((r) => r.kind === 'curriculum').map((r) => r.best);
const ref = rows.filter((r) => r.kind === 'refusal').map((r) => r.best);
const minCur = Math.min(...cur), maxRef = Math.max(...ref);
console.log(`\ncurriculum best-score range: ${Math.min(...cur).toFixed(3)} – ${Math.max(...cur).toFixed(3)}`);
console.log(`refusal best-score range: ${Math.min(...ref).toFixed(3)} – ${Math.max(...ref).toFixed(3)}`);
console.log(`suggested threshold: ${((minCur + maxRef) / 2).toFixed(2)} (midpoint; curriculum min ${minCur.toFixed(3)}, refusal max ${maxRef.toFixed(3)})`);
fs.writeFileSync('./calibration.json', JSON.stringify({ rows, minCurriculum: minCur, maxRefusal: maxRef, suggested: +((minCur + maxRef) / 2).toFixed(2) }, null, 2));
