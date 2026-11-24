// practice.js — pure helpers for Practice mode (teacher mode), shared by
// app.js and the Node verification script (work/test_practice.mjs).
// No browser APIs here: no DOM, no localStorage, no fetch.
import { singularize } from './textutil.js';

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

// ---- "Say it simpler" guard (v2.2 fix) ----
// The 135M model cannot be trusted to rephrase: with the exact shipped
// prompt ("Information: smart - smarter - smartest.") it answered
// "I'm ready to help you with your questions." — reproduced in Node
// (work/repro_simpler.mjs), and the same failure was seen twice in the
// browser. No prompt variant was reliable across 4 real step sets:
// greetings, system-prompt echo, invented facts ("a snail lives in
// water"), invented questions, repetition loops, few-shot example
// parroting (work/repro_simpler2.mjs). So the model output is checked
// against the steps it was asked to rephrase, and anything that fails
// falls back to the original steps — the board never shows a greeting
// or an invented sentence. The bug predates v2.2: v2.1 sent the same
// explanation-only prompt and wrote the same bad text into a paragraph
// instead of the board.
const SIMPLER_STOPWORDS = new Set(('the a an and or but with that this from into then when what which hint is are was were it its of to in on for by as at be been being am has have had do does did can could will would should may might must shall there here one two each until how why not no if so such than too very just like about over under after before between through during without within along across behind beyond plus except also more most other some only own same let lets').split(' '));

// Content words of the steps: words of 3+ letters, not stopwords,
// singularized. A rewording may only use these words (plus stopwords
// and numbers) — anything else is invented, not simplified.
function contentTokens(steps) {
  const out = new Set();
  for (const s of steps || []) {
    for (const w of String(s).toLowerCase().match(/[a-z]{3,}/g) || []) {
      if (!SIMPLER_STOPWORDS.has(w)) out.add(singularize(w));
    }
  }
  return out;
}

function normStep(s) {
  return String(s || '').toLowerCase().replace(/^hint:\s*/, '').replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

// Check a model rewording against the steps it was asked to rephrase.
// Returns the usable sentences, or [] when nothing is usable — the
// caller then shows the original steps. A sentence is dropped when it:
//   - asks a question (invented — a rewording never asks),
//   - repeats a step word-for-word (an echo, not a rewording),
//   - uses a content word that is not in the steps (invented fact), or
//   - carries no content word from the steps at all (greeting, filler,
//     system-prompt echo, few-shot example parrot).
// The whole output is dropped when one word repeats more than 6 times
// (the model's repetition loop: "smarter, smarter, smarter, ..."), and
// when the kept sentences together cover fewer than 2 distinct content
// words from the steps — a rewording that keeps only one word of a
// multi-step working (e.g. just "Multiples of 6: 6, 12, 18.") has
// dropped the teaching, so the original steps are shown instead.
export function simplerBoardSteps(modelText, steps) {
  const content = contentTokens(steps);
  if (!content.size) return [];
  const stepNorms = new Set((steps || []).map(normStep).filter(Boolean));
  const text = String(modelText || '');
  const toks = text.toLowerCase().match(/[a-z0-9]+/g) || [];
  const counts = new Map();
  for (const t of toks) {
    const n = (counts.get(t) || 0) + 1;
    if (n > 6) return [];
    counts.set(t, n);
  }
  const out = [];
  const seen = new Set();
  const covered = new Set();
  for (const raw of text.split(/(?<=[.!?])\s+/)) {
    const s = raw.trim();
    if (!s || s.includes('?')) continue;
    const n = normStep(s);
    if (!n || stepNorms.has(n) || seen.has(n)) continue;
    const words = (n.match(/[a-z]{3,}/g) || []).filter((w) => !SIMPLER_STOPWORDS.has(w)).map(singularize);
    if (!words.length) continue;
    if (!words.every((w) => content.has(w))) continue;
    seen.add(n);
    words.forEach((w) => covered.add(w));
    out.push(s);
  }
  if (covered.size < 2) return [];
  return out;
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
