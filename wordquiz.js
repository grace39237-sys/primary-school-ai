// wordquiz.js — multiple-choice meaning questions from word entries
// (v2.5, Won 2026-11-25). Pure functions: no DOM, no localStorage, no
// fetch. Shared by app.js and the Node test.
//
// A word item has the same shape as a quiz item, so the existing
// Practice rendering, checking (checkAnswer), step display (stepsOf)
// and adaptive level all work unchanged:
//   { id, question, type: 'multiple_choice', subject, grade, term: '',
//     unit: '', difficulty: 'easy', answer, options, explanation, hint }
// Words carry no difficulty of their own, so every item is 'easy' — the
// existing pickQuestion fallback (any difficulty when the wanted one is
// empty) already covers grades whose quiz bank also lacks harder items.
// The question is "What does "word" mean?" and the options are
// definitions: the right one plus 3 distractors from the same grade
// (class words) or the same level (Oxford words).
import { normAnswer } from './practice.js';

function shuffle(arr, rand) {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// Class-word entries for one grade, from the words.json map (keyed by
// lowercase word). Only 'Vocabulary' entries — lesson keywords and quiz
// definitions live in other subjects and are not grade word lists.
export function wordsByGradeVocabulary(dict, grade) {
  return Object.values(dict || {}).filter(
    (e) => e && e.subject === 'Vocabulary' && e.grade === grade && e.def,
  );
}

// Oxford entries for one level (lv 1–20).
export function wordsByLevel(entries, lv) {
  return (entries || []).filter((e) => e && e.lv === lv && e.def);
}

// One meaning question for `entry`, with distractors from `pool` (the
// same grade or level). Returns null when the pool has fewer than 4
// distinct definitions — a question with a repeated option would teach
// nothing. Options are shuffled with the injected rand (Math.random in
// the app, a fixed sequence in tests).
export function buildMeaningQuestion(entry, pool, opts = {}) {
  const rand = opts.rand || Math.random;
  const subject = opts.subject || 'Word';
  const grade = opts.grade || '';
  const idPrefix = opts.idPrefix || 'word';
  if (!entry || !entry.def) return null;
  const seen = new Set([normAnswer(entry.def)]);
  const distractors = [];
  for (const e of shuffle(pool || [], rand)) {
    if (distractors.length >= 3) break;
    if (!e || !e.def) continue;
    if (e === entry) continue;
    const d = normAnswer(e.def);
    if (!d || seen.has(d)) continue;
    seen.add(d);
    distractors.push(e.def);
  }
  if (distractors.length < 3) return null;
  const options = shuffle([entry.def, ...distractors], rand);
  const key = String(entry.w || '').trim().toLowerCase();
  return {
    id: `${idPrefix}:${grade}:${key}`,
    question: `What does "${entry.w}" mean?`,
    type: 'multiple_choice',
    subject,
    grade,
    term: '',
    unit: '',
    difficulty: 'easy',
    answer: entry.def,
    options,
    explanation: entry.ex ? `${entry.def} Example: ${entry.ex}` : entry.def,
    hint: '',
  };
}

// One item per entry (entries that cannot build a question are skipped).
// The bank is built once per grade/level, so picking stays on the
// existing pickQuestion path (random item, recent-ids + recent-correct
// filters, difficulty fallback).
export function buildWordBank(entries, opts = {}) {
  const out = [];
  for (const e of entries || []) {
    const item = buildMeaningQuestion(e, entries, opts);
    if (item) out.push(item);
  }
  return out;
}
