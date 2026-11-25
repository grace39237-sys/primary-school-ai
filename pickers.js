// pickers.js — pure picker-state transitions (no DOM), so Node tests can
// exercise the exact logic the browser runs (app.js only applies the
// result to the selects). Same extraction pattern as retrieval.js /
// choices.js: the decision lives here, the DOM wiring lives in app.js.

// ---- Ask grade (v2.4 filter; v2.6.1 KG removed) ----
// Valid Ask grades: 'all' or P1–P7. KG is gone — Won cancelled
// kindergarten (2026-11-25), so the selector offers All grades + P1–P7.
export function isValidAskGrade(g) {
  return g === 'all' || /^P[1-7]$/.test(g);
}
// A phone that saved 'KG' under v2.4 falls back to 'all' (never a
// refusal — the search just runs unfiltered). Anything unknown also
// falls back to 'all'. app.js rewrites a saved 'KG' to 'all' on load.
export function migrateAskGrade(saved) {
  if (saved === 'KG') return 'all';
  return isValidAskGrade(saved) ? saved : 'all';
}

// ---- Practice picker interlock (v2.5 Oxford; v2.6.1 restore) ----
// Oxford is a word track, not a grade: picking it forces Subject to
// Word, disables the Subject select, shows the Oxford Level picker and
// hides Term. Leaving Oxford must put everything back: re-enable
// Subject, restore the subject Oxford replaced (English if there was
// none saved), hide the Level picker, show Term again (unless the
// restored subject is Word, which has no term).
// prev: { wasOxford, preOxfordSubject } — the state updatePracticePickers
// keeps between calls. Returns the full next picker state.
export function nextPracticePickers(prev, grade, subject) {
  const isOxford = grade === 'Oxford';
  let { wasOxford, preOxfordSubject } = prev;
  if (isOxford) {
    // Record the replaced subject once, on entry — while Oxford is
    // active the select already reads 'Word', so re-recording would
    // overwrite the saved subject with 'Word'.
    if (!wasOxford) preOxfordSubject = subject;
    return { subject: 'Word', subjectDisabled: true, levelHidden: false, termHidden: true, wasOxford: true, preOxfordSubject };
  }
  let nextSubject = subject;
  if (wasOxford) {
    nextSubject = preOxfordSubject;
    wasOxford = false;
  }
  const isWord = nextSubject === 'Word';
  return { subject: nextSubject, subjectDisabled: false, levelHidden: true, termHidden: isWord, wasOxford, preOxfordSubject };
}
