// retrieval.js — pure retrieval math for Ask mode (v2.4). No browser APIs,
// no model loading, no module state: the app (rag.js) calls these with the
// loaded index, the Node test calls them with synthetic vectors.
//
// Vectors are int8-quantized per chunk with a float32 scale; cosine
// similarity is computed on dequantized values. The query is normalized
// and index vectors are normalized at build time, so the dot product IS
// the cosine similarity.
export function searchChunks(queryVec, chunks, vecs, dim, k = 5, pred = null) {
  const scored = [];
  for (let i = 0; i < chunks.length; i++) {
    if (pred && !pred(chunks[i])) continue;
    const scale = chunks[i].scale;
    const base = i * dim;
    let dot = 0;
    for (let d = 0; d < dim; d++) dot += vecs[base + d] * queryVec[d];
    scored.push({ chunk: chunks[i], score: dot * scale });
  }
  // Top-k by score (simple full sort is fine at ~54k rows).
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, k);
}
