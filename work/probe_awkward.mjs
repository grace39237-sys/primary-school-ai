// probe_awkward.mjs — one-off probe: how do awkward child questions score
// against the rebuilt v2.1 index? (Same search as calibrate_threshold.mjs.)
import { pipeline, env } from '@huggingface/transformers';
import fs from 'node:fs';

env.cacheDir = './.cache';
env.allowLocalModels = false;

const QUERIES = [
  'How the cloud make',
  'How are clouds made?',
  'What is a cloud?',
  'How does rain fall?',
  'Why the sky blue',
  'How plant grow',
  'What is quantum physics?',
  'How do I fix a car engine that will not start?',
];

const meta = JSON.parse(fs.readFileSync('../data/index.json', 'utf8'));
const vecs = new Int8Array(fs.readFileSync('../data/index.bin'));
const { dim, count, chunks } = meta;

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

for (const q of QUERIES) {
  const out = await emb(q, { pooling: 'mean', normalize: true });
  const hits = search(out.data, 3);
  console.log(`\nQ: "${q}"`);
  for (const h of hits) {
    console.log(`  ${h.score.toFixed(3)} [${h.chunk.kind} ${h.chunk.id}] :: ${(h.chunk.source || h.chunk.text || '').slice(0, 110)}`);
  }
}
