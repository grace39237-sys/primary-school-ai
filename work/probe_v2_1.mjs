// probe_v2_1.mjs — single-word RAG probe for v2.1.
// Embeds bare words and full questions against the REBUILT index and
// reports the best score + chunk. Expect:
//   "noun" (bare word)              -> below 0.67 (why the word lookup exists)
//   "What is a noun?" (full)       -> at/above 0.67 (RAG still answers)
//   "What is quantum physics?"     -> below 0.67 (refusal still works)
//   "giraffe" (bare word, in list)-> lookup answers it; RAG score is informational
// Run from ~/workspace/primary-school-ai/work: node probe_v2_1.mjs
import { pipeline, env } from '@huggingface/transformers';
import fs from 'node:fs';

env.cacheDir = './.cache';
env.allowLocalModels = false;

const meta = JSON.parse(fs.readFileSync('../data/index.json', 'utf8'));
const vecs = new Int8Array(fs.readFileSync('../data/index.bin'));
const { dim, count, chunks } = meta;
if (vecs.length !== count * dim) throw new Error('index size mismatch');
console.log(`index: ${count} chunks, dim ${dim}`);

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

for (const q of ['noun', 'What is a noun?', 'What is quantum physics?', 'giraffe', 'nouns']) {
  const out = await emb(q, { pooling: 'mean', normalize: true });
  const best = search(out.data, 1)[0];
  console.log(`"${q}" best=${best.score.toFixed(3)} via ${best.chunk.id} [${best.chunk.kind}] :: ${best.chunk.source.slice(0, 80)}`);
}
