// textutil.js — cleanup for speech-recognition results (pure functions,
// no dependencies). Copied from the translator app (v12).
//
// Small ASR models sometimes repeat the same sentence when noise or long
// silence creeps in. Clean the transcript before it is shown or asked.
export function collapseRepeats(text) {
  if (!text) return text;
  // 1) Sentence level: consecutive identical sentences collapse to one.
  const parts = text.split(/(?<=[.!?。！？])\s+/);
  const deduped = [];
  for (const p of parts) {
    if (p && !(deduped.length && deduped[deduped.length - 1] === p)) deduped.push(p);
  }
  let out = deduped.join(' ');
  // 2) A whole phrase repeated with no punctuation ("hello hello hello")
  // collapses to one copy.
  const words = out.split(/\s+/).filter(Boolean);
  if (words.length >= 2) {
    for (let n = 1; n <= Math.floor(words.length / 2); n++) {
      if (words.length % n !== 0) continue;
      const unit = words.slice(0, n).join(' ');
      if (words.join(' ') === Array(words.length / n).fill(unit).join(' ')) {
        out = unit;
        break;
      }
    }
  }
  return out;
}
