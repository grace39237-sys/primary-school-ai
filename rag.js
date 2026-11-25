// rag.js — retrieval over the prebuilt index (data/index.json + index.bin).
// Embeddings: Xenova/all-MiniLM-L6-v2 int8 (22MB), mean pooling, normalized.
// Index vectors are int8-quantized per chunk with a float32 scale stored in
// index.json; cosine similarity is computed on dequantized values in JS.
import { pipeline } from './vendor/transformers.web.min.js';
import { searchChunks } from './retrieval.js';

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
  return searchChunks(queryVec, idx.chunks, idx.vecs, idx.dim, k);
}

// Grade-first search (v2.4): top k chunks from one grade only. Returns []
// when the grade has no chunks in the index.
export function searchInGrade(queryVec, grade, k = 5) {
  const idx = index;
  return searchChunks(queryVec, idx.chunks, idx.vecs, idx.dim, k, (c) => c.grade === grade);
}
