// build_words.mjs — builds data/words.json, the direct word-lookup list
// for Ask mode (v2.1). A single word (or two-word phrase) is answered
// straight from this list — no model, no retrieval — because a bare word
// embeds too poorly to clear the 0.67 refusal threshold.
//
// Sources, in priority order (first entry wins for a word):
//   1. class_words.json P1–P7 (word + definition + example)
//   2. lesson keywords from the books ([word, definition, example?])
//   3. quiz items asking "What is a/an/the X?" (explanation is the definition)
//
// "noun" is a good example of why all three are needed: it is in NONE of
// the class words or lesson keywords — its definition lives only in the
// quiz item "What is a noun?" (P311010001).
//
// Usage: node build_words.mjs   (run from ~/workspace/primary-school-ai/work)
import fs from 'node:fs';
import path from 'node:path';

const DATA = '/home/hatch/workspace/word-words-repo/data';
const BOOKS = '/home/hatch/workspace/word-words-repo/books';
const OUT = '/home/hatch/workspace/primary-school-ai/data/words.json';

function parseBook(p) {
  const s = fs.readFileSync(p, 'utf8');
  const i = s.indexOf('var BOOK = ');
  if (i < 0) throw new Error(`no BOOK in ${p}`);
  let d = 0, inStr = false, esc = false;
  const start = i + 'var BOOK = '.length;
  for (let j = start; j < s.length; j++) {
    const c = s[j];
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') { inStr = true; continue; }
    if (c === '{') d++;
    else if (c === '}') { d--; if (d === 0) return JSON.parse(s.slice(start, j + 1)); }
  }
  throw new Error(`BOOK not closed in ${p}`);
}

const normSubject = (s) => {
  const t = String(s || '').trim().toLowerCase();
  if (!t) return 'General';
  return t[0].toUpperCase() + t.slice(1);
};
const normGrade = (g) => String(g || '').trim().toUpperCase();
const normKey = (w) => String(w || '').trim().toLowerCase().replace(/-/g, ' ').replace(/\s+/g, ' ');
// Book text sometimes carries markdown bold (**word**); strip it so the
// board shows plain words, not asterisks.
const cleanText = (t) => String(t || '').replace(/\*\*/g, '').trim();

const words = {}; // key -> { w, def, ex, grade, subject, unit }
let cwN = 0, kwN = 0, quizN = 0;
function add(key, entry) {
  const k = normKey(key);
  if (!k || words[k]) return false;
  words[k] = { w: key.trim(), ...entry };
  return true;
}

// 1. Class words (P1–P7 only; KG is out of scope).
const cw = JSON.parse(fs.readFileSync(path.join(DATA, 'class_words.json'), 'utf8'));
for (const [grade, list] of Object.entries(cw)) {
  if (normGrade(grade) === 'KG') continue;
  for (const e of list) {
    if (add(e.w, { def: cleanText(e.def), ex: cleanText(e.ex), grade: normGrade(grade), subject: 'Vocabulary', unit: '' })) cwN++;
  }
}

// 2. Lesson keywords from the books.
for (const f of fs.readdirSync(BOOKS).filter((x) => /^P[1-7]_.*\.html$/.test(x) && !x.includes('_teacher')).sort()) {
  const book = parseBook(path.join(BOOKS, f));
  const subject = normSubject(book.subject);
  const grade = normGrade(book.grade);
  for (const term of book.terms || []) {
    for (const theme of term.themes || []) {
      for (const l of theme.lessons || []) {
        for (const k of l.keywords || []) {
          if (!Array.isArray(k) || !k[0] || !k[1]) continue;
          if (add(k[0], { def: cleanText(k[1]), ex: cleanText(k[2]), grade, subject, unit: l.title || '' })) kwN++;
        }
      }
    }
  }
}

// 3. Quiz "What is a/an/the X?" items — the explanation defines X.
const whatIs = /^\s*what is (?:an?|the)?\s+([a-z][a-z\- ]*?)\s*\??\s*$/i;
for (const f of fs.readdirSync(DATA).filter((x) => /^quiz_p[1-7]_/.test(x)).sort()) {
  const items = JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8'));
  for (const it of items) {
    const m = whatIs.exec(it.question || '');
    if (!m) continue;
    const key = normKey(m[1]);
    if (!key || key.split(' ').length > 2) continue; // lookup only answers 1–2 word queries
    const def = cleanText(it.explanation || it.answer || '');
    if (!def) continue;
    if (add(key, { def, ex: '', grade: normGrade(it.grade), subject: normSubject(it.subject), unit: it.unit || '' })) quizN++;
  }
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(words));
console.log(`words.json: class words ${cwN} + lesson keywords ${kwN} + quiz definitions ${quizN} = ${Object.keys(words).length} entries, ${fs.statSync(OUT).size} bytes`);
console.log('noun:', JSON.stringify(words['noun'] || null));
console.log('giraffe:', JSON.stringify(words['giraffe'] || null));
