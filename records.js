// records.js — phone-only learning records (v2.5, Won 2026-11-25).
// Pure functions: no DOM, no localStorage, no fetch. app.js owns the
// localStorage read/write; this module only shapes and updates the data.
//
// What is recorded, and what is NOT:
//   - Per-subject correct/total + last practiced date (average shown as %).
//   - Recent Ask questions (newest first, cap 20) so the child can tap
//     one and ask it again.
//   - The current level is NOT stored here: it already lives in
//     'psa-level' (Practice). summarize() reads it from there, so the
//     level is never duplicated.
//   - No accounts, no server, no name picker (Won: one record per phone).
//     Changing phones or clearing browser data erases the record.
//
// Recently-correct skip (Practice): an item answered correctly is not
// asked again for 7 days, so progress continues instead of looping the
// same questions. Stored separately under RECENT_CORRECT_KEY as
// { itemId: 'YYYY-MM-DD' } — the map is capped at 200 entries.
export const RECORDS_KEY = 'psa-records';
export const RECENT_CORRECT_KEY = 'psa-recent-correct';
export const RECENT_CORRECT_DAYS = 7;
export const MAX_QUESTIONS = 20;
export const MAX_RECENT_CORRECT = 200;

export const SUBJECT_ORDER = ['English', 'Math', 'Science', 'Social', 'Word', 'Oxford'];
export const SUBJECT_LABEL = {
  English: 'English',
  Math: 'Maths',
  Science: 'Science',
  Social: 'Social Studies',
  Word: 'Word',
  Oxford: 'Oxford',
};

export function emptyRecord() {
  return { v: 1, subjects: {}, questions: [] };
}

// Parse stored JSON; anything unusable falls back to an empty record.
export function loadRecord(raw) {
  try {
    const d = JSON.parse(raw);
    if (!d || typeof d !== 'object') return emptyRecord();
    return {
      v: 1,
      subjects: (d.subjects && typeof d.subjects === 'object') ? d.subjects : {},
      questions: Array.isArray(d.questions) ? d.questions : [],
    };
  } catch (_) {
    return emptyRecord();
  }
}

// Local date as 'YYYY-MM-DD'.
export function todayStr(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// '2026-11-25' -> '25 Nov' (kid-readable, no year).
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function displayDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  if (!m) return '';
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1] || ''}`.trim();
}

// One answered Practice question. Mutates + returns the record.
export function recordPracticeAnswer(rec, subject, correct, date) {
  if (!rec || !subject) return rec;
  const sub = rec.subjects[subject] || { correct: 0, total: 0, last: '' };
  sub.total += 1;
  if (correct) sub.correct += 1;
  sub.last = date || todayStr();
  rec.subjects[subject] = sub;
  return rec;
}

// One asked question (Ask mode). Newest first; the same question asked
// again (ignoring case and surrounding space) moves to the top instead
// of duplicating — the first-asked wording is kept, only the date is
// refreshed. Capped at MAX_QUESTIONS. Mutates + returns the record.
export function recordAskQuestion(rec, q, date) {
  if (!rec) return rec;
  const text = String(q || '').trim();
  if (!text) return rec;
  const norm = text.toLowerCase().replace(/\s+/g, ' ');
  const existing = rec.questions.find((e) => String(e.q || '').toLowerCase().replace(/\s+/g, ' ') === norm);
  rec.questions = rec.questions.filter((e) => e !== existing);
  rec.questions.unshift({ q: existing ? existing.q : text, date: date || todayStr() });
  if (rec.questions.length > MAX_QUESTIONS) rec.questions.length = MAX_QUESTIONS;
  return rec;
}

// Average score as a rounded %, or null when nothing was answered yet.
export function subjectPercent(sub) {
  if (!sub || !sub.total) return null;
  return Math.round((sub.correct / sub.total) * 100);
}

// Rows for the 'My learning' card: one per practiced subject, in fixed
// order. The level comes from the saved Practice levels (levels map) —
// never from the record itself. Subjects with no answers are not listed.
export function summarize(rec, levels = {}) {
  const out = [];
  for (const key of SUBJECT_ORDER) {
    const sub = rec?.subjects?.[key];
    if (!sub || !sub.total) continue;
    const lv = levels[key];
    out.push({
      key,
      label: SUBJECT_LABEL[key] || key,
      pct: subjectPercent(sub),
      correct: sub.correct,
      total: sub.total,
      level: (lv && lv.difficulty) || 'easy',
      last: displayDate(sub.last),
    });
  }
  return out;
}

// ---- Recently-correct skip ----
function dayDiff(a, b) {
  // Whole days between two 'YYYY-MM-DD' dates (UTC midnight, so the
  // device timezone cannot shift the count).
  return Math.floor((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
}

// Remember an item as answered correctly today. Oldest entries are
// evicted past the cap. Returns a new map.
export function markCorrect(map, id, date) {
  const out = { ...(map || {}) };
  delete out[id];
  out[id] = date || todayStr();
  const keys = Object.keys(out);
  if (keys.length > MAX_RECENT_CORRECT) {
    for (const k of keys.slice(0, keys.length - MAX_RECENT_CORRECT)) delete out[k];
  }
  return out;
}

// True when the item was answered correctly less than
// RECENT_CORRECT_DAYS ago (same day counts as 0 days).
export function isRecentlyCorrect(map, id, today) {
  const d = (map || {})[id];
  if (!d) return false;
  const n = dayDiff(d, today || todayStr());
  return n >= 0 && n < RECENT_CORRECT_DAYS;
}

// Drop entries older than the skip window. Returns a new map.
export function pruneRecentCorrect(map, today) {
  const out = {};
  const now = today || todayStr();
  for (const [id, d] of Object.entries(map || {})) {
    const n = dayDiff(d, now);
    if (n >= 0 && n < RECENT_CORRECT_DAYS) out[id] = d;
  }
  return out;
}
