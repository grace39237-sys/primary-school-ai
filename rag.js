// rag.js — retrieval over the prebuilt index (data/index.json + index.bin).
// Embeddings: Xenova/all-MiniLM-L6-v2 int8 (22MB), mean pooling, normalized.
// Index vectors are int8-quantized per chunk with a float32 scale stored in
// index.json; cosine similarity is computed on dequantized values in JS.
import { pipeline } from './vendor/transformers.web.min.js';

export const EMBED_MODEL = 'Xenova/all-MiniLM-L6-v2';

let embedder = null;
let index = null; // { dim, count, chunks: [...], vecs: Int8Array }

export async function loadEmbedder(onProgress) {
  if (embedder) return embedder;
  embedder = await pipeline('feature-extraction', EMBED_MODEL, { dtype: 'q8', progress_callback: onProgress });
  return embedder;
}

export async function loadIndex() {
  if (index) return index;
  const [metaResp, binResp] = await Promise.all([
    fetch('./data/index.json'),
    fetch('./data/index.bin'),
  ]);
  if (!metaResp.ok) throw new Error(`index.json failed (${metaResp.status})`);
  if (!binResp.ok) throw new Error(`index.bin failed (${binResp.status})`);
  const meta = await metaResp.json();
  const buf = await binResp.arrayBuffer();
  index = { dim: meta.dim, count: meta.count, chunks: meta.chunks, vecs: new Int8Array(buf) };
  if (index.vecs.length !== index.count * index.dim) {
    throw new Error(`index.bin size mismatch (${index.vecs.length} != ${index.count * index.dim})`);
  }
  return index;
}

// Query embedding: normalized float32 vector (384 dims).
export async function embedQuery(text) {
  const emb = await loadEmbedder();
  const out = await emb(text, { pooling: 'mean', normalize: true });
  return out.data; // Float32Array, already normalized
}

// Cosine similarity against the int8 index. Returns top k chunks with scores.
// Vectors are normalized at build time and the query is normalized, so the
// dot product IS the cosine similarity.
export function search(queryVec, k = 5) {
  const idx = index;
  const { dim, count, chunks, vecs } = idx;
  const scored = new Array(count);
  for (let i = 0; i < count; i++) {
    const scale = chunks[i].scale;
    const base = i * dim;
    let dot = 0;
    for (let d = 0; d < dim; d++) dot += vecs[base + d] * queryVec[d];
    scored[i] = dot * scale;
  }
  // Top-k by partial selection (simple full sort is fine at ~54k rows).
  const order = scored.map((s, i) => i).sort((a, b) => scored[b] - scored[a]).slice(0, k);
  return order.map((i) => ({ chunk: chunks[i], score: scored[i] }));
}
