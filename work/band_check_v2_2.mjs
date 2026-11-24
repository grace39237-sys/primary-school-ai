// band_check_v2_2.mjs — measure which band each test question lands in
// under the v2.2 thresholds (direct >= 0.67, choices 0.40–0.67, refuse
// < 0.40). Run from ~/workspace/primary-school-ai/work:
// node band_check_v2_2.mjs
//
// For 'choices' questions it also prints the 3 choice labels the child
// would see, so the safeguard can be judged: an off-topic question that
// lands in the choices band must still offer sensible, grounded options
// the child can reject with "None of these".
import { pipeline, env } from '@huggingface/transformers';
import fs from 'node:fs';
import { classifyBand, distinctChoices } from '../choices.js';

env.cacheDir = './.cache';
env.allowLocalModels = false;

const CASES = [
  // 16 calibration questions (work/calibrate_threshold.mjs)
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
  // Awkward child questions (work/probe_awkward.mjs)
  { id: 'A1', kind: 'awkward', q: 'How the cloud make' },
  { id: 'A2', kind: 'awkward', q: 'How are clouds made?' },
  { id: 'A3', kind: 'awkward', q: 'What is a cloud?' },
  { id: 'A4', kind: 'awkward', q: 'How does rain fall?' },
  { id: 'A5', kind: 'awkward', q: 'Why the sky blue' },
  { id: 'A6', kind: 'awkward', q: 'How plant grow' },
  { id: 'A7', kind: 'refusal', q: 'What is quantum physics?' },
  { id: 'A8', kind: 'refusal', q: 'How do I fix a car engine that will not start?' },
];

const meta = JSON.parse(fs.readFileSync('../data/index.json', 'utf8'));
const vecs = new Int8Array(fs.readFileSync('../data/index.bin'));
const { dim, count, chunks } = meta;

const emb = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', { dtype: 'q8' });
function search(qvec, k = 5) {
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

const tally = {};
for (const c of CASES) {
  const out = await emb(c.q, { pooling: 'mean', normalize: true });
  const hits = search(out.data, 5);
  const best = hits[0].score;
  const band = classifyBand(best);
  tally[`${c.kind}:${band}`] = (tally[`${c.kind}:${band}`] || 0) + 1;
  let line = `${c.id} [${c.kind}] best=${best.toFixed(3)} -> ${band.toUpperCase()} :: ${hits[0].chunk.id}`;
  if (band === 'choices') {
    const ch = distinctChoices(hits, 3);
    line += `\n    choices: ${ch.map((x) => `"${x.label}"`).join(' | ')}`;
  }
  console.log(line);
}
console.log('\ntally:', JSON.stringify(tally));
