// practice.js — pure helpers for Practice mode (teacher mode), shared by
// app.js and the Node verification script (work/test_practice.mjs).
// No browser APIs here: no DOM, no localStorage, no fetch.

export const DIFF_ORDER = ['easy', 'medium', 'hard'];

export function normAnswer(s) {
  return String(s || '').trim().toLowerCase().replace(/[.,!?;:'"()]+$/g, '').replace(/\s+/g, ' ');
}

// item: quiz item. user: string (typed/chosen) or string[] (multi_select).
// Correct if the normalized answers match, or if the child's longer answer
// contains the expected short answer (e.g. "to pass urine and stool"
// for "passing urine and stool" is still wrong — but "eggs" inside
// "eggs are laid by hens" counts).
export function checkAnswer(item, user) {
  const expected = normAnswer(item.answer);
  if (item.type === 'multi_select') {
    const exp = (Array.isArray(item.answer) ? item.answer : [item.answer]).map(normAnswer).sort();
    const got = (Array.isArray(user) ? user : [user]).map(normAnswer).sort();
    return JSON.stringify(exp) === JSON.stringify(got);
  }
  const got = normAnswer(user);
  if (!got) return false;
  if (got === expected) return true;
  return expected.length >= 2 && got.includes(expected);
}

// The explanation is the verified working — split into numbered steps.
// The model never writes maths steps; it may only rephrase this text.
export function stepsOf(item) {
  const steps = [];
  if (item.hint) steps.push(`Hint: ${item.hint}`);
  const expl = (item.explanation || '').trim();
  if (expl) {
    const parts = expl.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
    steps.push(...parts);
  }
  if (!steps.length) steps.push(`The answer is ${item.answer}.`);
  return steps;
}

// Adaptive level transition. level = { difficulty, streak }.
// Right: streak+1; two in a row moves one difficulty up (streak resets).
// Wrong: streak resets, difficulty stays (the next question stays on the
// same concept at the same or an easier level — chosen by the caller).
export function nextLevel(level, correct) {
  if (correct) {
    const streak = level.streak + 1;
    let difficulty = level.difficulty;
    let nextStreak = streak;
    if (streak >= 2) {
      const i = DIFF_ORDER.indexOf(difficulty);
      if (i < DIFF_ORDER.length - 1) { difficulty = DIFF_ORDER[i + 1]; nextStreak = 0; }
    }
    return { difficulty, streak: nextStreak };
  }
  return { difficulty: level.difficulty, streak: 0 };
}
