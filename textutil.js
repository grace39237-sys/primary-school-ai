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

// singularize — strip a trailing "s" from one word, for comparison only
// ("clouds" -> "cloud"). Used for dedup keys (choices.js) and content
// matching ("Say it simpler" guard, practice.js). Never for display
// text. Guards keep "glass", "gas" and "this" intact.
export function singularize(w) {
  const s = String(w || '').toLowerCase();
  if (s.length < 4 || !s.endsWith('s')) return s;
  if (s.endsWith('ss') || s.endsWith('us') || s.endsWith('is')) return s;
  if (/(sses|xes|zes|ches|shes)$/.test(s)) return s.slice(0, -2);
  return s.slice(0, -1);
}

// stripMarkdown — remove markdown markers from a display string, so the
// child never sees literal '**' (v2.4, Won 2026-11-25). The quiz data's
// own style writes "The air feels **___**." and "The air feels
// **cold**." — and the model echoes context, so '**' can also appear in
// generated answers. Display side only: the data and the index are
// untouched, and '___' blanks are kept.
//
// Guards: the single-star rule only wraps ONE word containing a letter,
// so maths ("3 * 4", "2 * 3 * 4") survives — the curriculum writes
// multiplication with "x" anyway.
export function stripMarkdown(text) {
  if (text == null) return text;
  let out = String(text);
  out = out.replace(/\*\*([^*]+)\*\*/g, '$1'); // **bold** -> bold
  out = out.replace(/(^|[\s(])\*([^*\s]*[A-Za-z][^*\s]*)\*(?=[\s).,;:!?]|$)/g, '$1$2'); // *word* -> word
  out = out.replace(/`([^`]*)`/g, '$1'); // `code` -> code
  out = out.replace(/^#{1,6}\s+/gm, ''); // # heading -> plain
  out = out.replace(/\*\*/g, ''); // stray ** fragments
  out = out.replace(/`/g, ''); // stray backticks
  return out;
}
