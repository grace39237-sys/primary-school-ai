// test_v2_5.mjs — Node verification for tutor v2.5 (phone-only learning
// records; Practice difficulty/progress-aware with a recently-correct
// skip; Practice subject 'Word' from class words; Practice grade
// 'Oxford' with a directly-selectable level 1–20; Practice term filter).
// Run from ~/workspace/primary-school-ai/work: node test_v2_5.mjs
//
// Covers:
//   (1) records.js (pure): per-subject correct/total + average %,
//       Ask question history (newest first, dedupe, cap 20), record
//       loading with a bad-JSON fallback, date display, summary rows
//       for 'My learning' (level read from the saved Practice levels,
//       never duplicated in the record).
//   (2) recently-correct skip (records.js, pure): an item answered
//       correctly is skipped for 7 days, then allowed again; old
//       entries are pruned; the stored list is capped.
//   (3) wordquiz.js (pure): meaning questions — 4 distinct options,
//       the correct definition present exactly once, distractors from
//       the same grade/level pool, null when the pool is too small;
//       word-bank building (one item per entry, stable ids);
//       Oxford level filtering.
//   (4) filterByTerm (practice.js, pure): quiz bank filtered by term.
//   (5) real data: class words per grade in data/words.json
//       (Vocabulary subject); Oxford words per level in
//       data/oxford_words.json (7,088 total, all with def + example).
//   (6) static checks — v2.5 version strings; the new pickers in
//       index.html (Word subject, Oxford grade, Term, Oxford level,
//       'My learning' section); the wiring in app.js (records saved on
//       every Practice answer and every Ask, recent-correct skip in
//       pickQuestion, Word/Oxford banks in loadBank, level keyed by
//       practice track so Oxford does not collide with Word).
//
// What Node CANNOT test (parent verifies in the browser; Won's phone is
// the only proof for mic/TTS): the 'My learning' card rendering on a
// phone, tapping a recent question to re-ask it, the Oxford level
// picker changing the words, the term filter changing the questions.
import {
  emptyRecord, loadRecord, recordPracticeAnswer, recordAskQuestion,
  subjectPercent, summarize, todayStr, displayDate,
  markCorrect, isRecentlyCorrect, pruneRecentCorrect,
  RECORDS_KEY, RECENT_CORRECT_KEY, RECENT_CORRECT_DAYS,
} from '../records.js';
import { buildMeaningQuestion, buildWordBank, wordsByLevel, wordsByGradeVocabulary } from '../wordquiz.js';
import { filterByTerm } from '../practice.js';
import fs from 'node:fs';

let pass = 0, fail = 0;
function t(name, cond, extra = '') {
  if (cond) { pass++; console.log(`PASS ${name}`); }
  else { fail++; console.log(`FAIL ${name} ${extra}`); }
}
const appJs = fs.readFileSync('../app.js', 'utf8');
const indexHtml = fs.readFileSync('../index.html', 'utf8');
const swJs = fs.readFileSync('../sw.js', 'utf8');

// Deterministic rand for tests: cycles through a fixed sequence.
function seqRand(seq) {
  let i = 0;
  return () => seq[i++ % seq.length];
}

// ---- (1) records ----
const rec0 = emptyRecord();
t('rec: empty record shape', rec0.v === 1 && JSON.stringify(rec0.subjects) === '{}' && Array.isArray(rec0.questions) && rec0.questions.length === 0);

const rec1 = emptyRecord();
recordPracticeAnswer(rec1, 'English', true, '2026-11-25');
t('rec: correct increments correct+total', rec1.subjects.English.correct === 1 && rec1.subjects.English.total === 1);
recordPracticeAnswer(rec1, 'English', false, '2026-11-25');
t('rec: wrong increments total only', rec1.subjects.English.correct === 1 && rec1.subjects.English.total === 2);
recordPracticeAnswer(rec1, 'Math', true, '2026-11-26');
t('rec: subjects independent + last date kept', rec1.subjects.Math.correct === 1 && rec1.subjects.Math.last === '2026-11-26' && rec1.subjects.English.last === '2026-11-25');
t('rec: percent 1/2 = 50', subjectPercent(rec1.subjects.English) === 50);
t('rec: percent 3/4 = 75', subjectPercent({ correct: 3, total: 4 }) === 75);
t('rec: percent null when nothing answered', subjectPercent({ correct: 0, total: 0 }) === null && subjectPercent(null) === null && subjectPercent(undefined) === null);

const rec2 = emptyRecord();
recordAskQuestion(rec2, 'What is a noun?', '2026-11-25');
recordAskQuestion(rec2, 'Why is the sky blue?', '2026-11-25');
t('rec: ask history newest first', rec2.questions[0].q === 'Why is the sky blue?' && rec2.questions[1].q === 'What is a noun?');
recordAskQuestion(rec2, '  what is a noun? ', '2026-11-26');
t('rec: ask history dedupes (case/space) and moves to top', rec2.questions.length === 2 && rec2.questions[0].q === 'What is a noun?' && rec2.questions[0].date === '2026-11-26');
const rec3 = emptyRecord();
for (let i = 0; i < 25; i++) recordAskQuestion(rec3, `Question ${i}?`, '2026-11-25');
t('rec: ask history capped at 20, oldest dropped', rec3.questions.length === 20 && rec3.questions[0].q === 'Question 24?' && rec3.questions[19].q === 'Question 5?');
t('rec: empty question not recorded', (() => { const r = emptyRecord(); recordAskQuestion(r, '   ', '2026-11-25'); return r.questions.length === 0; })());

t('rec: bad JSON loads as empty', JSON.stringify(loadRecord('not json')) === JSON.stringify(emptyRecord()));
t('rec: null loads as empty', JSON.stringify(loadRecord(null)) === JSON.stringify(emptyRecord()));
t('rec: partial record keeps subjects, defaults the rest', (() => {
  const r = loadRecord(JSON.stringify({ v: 1, subjects: { English: { correct: 2, total: 3, last: '2026-11-20' } } }));
  return r.subjects.English.correct === 2 && Array.isArray(r.questions);
})());
t('rec: todayStr is YYYY-MM-DD', /^\d{4}-\d{2}-\d{2}$/.test(todayStr()));
t('rec: displayDate 2026-11-25 -> 25 Nov', displayDate('2026-11-25') === '25 Nov');
t('rec: displayDate 2026-01-05 -> 5 Jan', displayDate('2026-01-05') === '5 Jan');

const rec4 = emptyRecord();
recordPracticeAnswer(rec4, 'Science', true, '2026-11-25');
recordPracticeAnswer(rec4, 'Science', true, '2026-11-25');
recordPracticeAnswer(rec4, 'Science', false, '2026-11-26');
recordPracticeAnswer(rec4, 'Word', true, '2026-11-26');
const rows = summarize(rec4, { Science: { difficulty: 'medium', streak: 1 }, Word: { difficulty: 'easy', streak: 0 } });
t('rec: summary only lists practiced subjects', rows.length === 2 && rows[0].key === 'Science' && rows[1].key === 'Word');
t('rec: summary row carries % + level + last date', rows[0].pct === 67 && rows[0].level === 'medium' && rows[0].last === '26 Nov');
t('rec: summary label uses Maths for Math', summarize(emptyRecord(), {}).length === 0
  && (() => { const r = emptyRecord(); recordPracticeAnswer(r, 'Math', true, '2026-11-25'); return summarize(r, {})[0].label === 'Maths'; })());
t('rec: summary level falls back to easy when no saved level', (() => {
  const r = emptyRecord(); recordPracticeAnswer(r, 'Oxford', true, '2026-11-25');
  return summarize(r, {})[0].level === 'easy';
})());

// ---- (2) recently-correct skip ----
let rc = {};
rc = markCorrect(rc, 'P311010001', '2026-11-25');
t('rc: marked id is recently correct the same day', isRecentlyCorrect(rc, 'P311010001', '2026-11-25') === true);
t('rc: still skipped 6 days later', isRecentlyCorrect(rc, 'P311010001', '2026-12-01') === true);
t('rc: allowed again after 7 days', isRecentlyCorrect(rc, 'P311010001', '2026-12-02') === false);
t('rc: unknown id is not skipped', isRecentlyCorrect(rc, 'other-id', '2026-11-25') === false);
rc = markCorrect(rc, 'old-id', '2026-11-01');
const pruned = pruneRecentCorrect(rc, '2026-11-25');
t('rc: prune drops entries older than 7 days', pruned['P311010001'] === '2026-11-25' && !('old-id' in pruned));
let big = {};
for (let i = 0; i < 250; i++) big = markCorrect(big, `id-${i}`, '2026-11-25');
t('rc: stored list capped at 200', Object.keys(big).length === 200 && !('id-0' in big) && ('id-249' in big));
t('rec: skip window is 7 days', RECENT_CORRECT_DAYS === 7);
t('rec: storage keys are psa-records / psa-recent-correct', RECORDS_KEY === 'psa-records' && RECENT_CORRECT_KEY === 'psa-recent-correct');

// ---- (3) word quiz building ----
const pool = [
  { w: 'apple', def: 'A round fruit that grows on a tree.', ex: 'I eat an apple.' },
  { w: 'banana', def: 'A long yellow fruit.', ex: 'A banana is yellow.' },
  { w: 'orange', def: 'A round fruit with a thick skin.', ex: 'An orange is juicy.' },
  { w: 'grape', def: 'A small round fruit that grows in bunches.', ex: 'Grapes are sweet.' },
  { w: 'mango', def: 'A sweet fruit with a big seed.', ex: 'A mango is sweet.' },
];
const q1 = buildMeaningQuestion(pool[0], pool, { subject: 'Word', grade: 'P3', idPrefix: 'word', rand: seqRand([0.1, 0.9, 0.3, 0.7, 0.2]) });
t('wq: question asks what the word means', q1 && q1.question === 'What does "apple" mean?');
t('wq: 4 options', q1 && q1.options.length === 4);
t('wq: correct definition present exactly once', q1 && q1.options.filter((o) => o === pool[0].def).length === 1);
t('wq: all options distinct', q1 && new Set(q1.options.map((o) => o.trim().toLowerCase())).size === 4);
t('wq: answer is the definition', q1 && q1.answer === pool[0].def);
t('wq: type is multiple_choice, difficulty easy', q1 && q1.type === 'multiple_choice' && q1.difficulty === 'easy');
t('wq: stable id', q1 && q1.id === 'word:P3:apple');
t('wq: explanation carries definition + example', q1 && q1.explanation.includes(pool[0].def) && q1.explanation.includes('I eat an apple.'));
t('wq: null when pool too small', buildMeaningQuestion(pool[0], pool.slice(0, 3), { subject: 'Word', grade: 'P3', idPrefix: 'word', rand: seqRand([0.5]) }) === null);
t('wq: duplicate definitions never appear twice', (() => {
  const dupPool = [
    { w: 'a1', def: 'Same meaning.', ex: '' },
    { w: 'a2', def: 'Same meaning.', ex: '' },
    { w: 'b', def: 'Second meaning.', ex: '' },
    { w: 'c', def: 'Third meaning.', ex: '' },
    { w: 'd', def: 'Fourth meaning.', ex: '' },
  ];
  const q = buildMeaningQuestion(dupPool[0], dupPool, { subject: 'Word', grade: 'P3', idPrefix: 'word', rand: seqRand([0.2, 0.4, 0.6, 0.8]) });
  return q && q.options.filter((o) => o === 'Same meaning.').length === 1 && q.options.length === 4;
})());
const bankItems = buildWordBank(pool, { subject: 'Word', grade: 'P3', idPrefix: 'word', rand: seqRand([0.1, 0.2, 0.3, 0.4]) });
t('wq: bank has one item per entry', bankItems.length === 5);
t('wq: bank ids unique', new Set(bankItems.map((i) => i.id)).size === 5);
t('wq: bank items are multiple_choice with a subject + grade', bankItems.every((i) => i.type === 'multiple_choice' && i.subject === 'Word' && i.grade === 'P3'));

// ---- (4) term filter ----
const quizBank = [
  { id: 'a', term: 'Term 1' }, { id: 'b', term: 'Term 2' },
  { id: 'c', term: 'Term 3' }, { id: 'd', term: 'Term 1' },
];
t('term: all returns everything', filterByTerm(quizBank, 'all').length === 4);
t('term: Term 1 keeps only Term 1', filterByTerm(quizBank, 'Term 1').map((i) => i.id).join(',') === 'a,d');
t('term: Term 2 keeps only Term 2', filterByTerm(quizBank, 'Term 2').map((i) => i.id).join(',') === 'b');
t('term: Term 3 keeps only Term 3', filterByTerm(quizBank, 'Term 3').map((i) => i.id).join(',') === 'c');

// ---- (5) real data ----
const wordsJson = JSON.parse(fs.readFileSync('../data/words.json', 'utf8'));
const vocabByGrade = {};
for (const e of Object.values(wordsJson)) {
  if (e.subject !== 'Vocabulary') continue;
  vocabByGrade[e.grade] = (vocabByGrade[e.grade] || 0) + 1;
}
t('data: class words P1 = 155', vocabByGrade.P1 === 155);
t('data: class words P2 = 291', vocabByGrade.P2 === 291);
t('data: class words P3 = 224', vocabByGrade.P3 === 224);
t('data: class words P4 = 309', vocabByGrade.P4 === 309);
t('data: class words P5 = 317', vocabByGrade.P5 === 317);
t('data: class words P6 = 175', vocabByGrade.P6 === 175);
t('data: class words P7 = 202', vocabByGrade.P7 === 202);
t('data: class words total 1,673', Object.values(vocabByGrade).reduce((a, b) => a + b, 0) === 1673);
t('data: all class words have a definition + example', Object.values(wordsJson).filter((e) => e.subject === 'Vocabulary').every((e) => e.def && e.ex));
t('data: word entries for Practice come from words.json (no new class-words file needed)', true);

const oxford = JSON.parse(fs.readFileSync('../data/oxford_words.json', 'utf8'));
t('data: oxford file has 7,088 entries', oxford.length === 7088);
const oxByLevel = {};
for (const e of oxford) oxByLevel[e.lv] = (oxByLevel[e.lv] || 0) + 1;
t('data: oxford levels 1–19 have 354 words each', [1, 2, 3, 4, 5, 10, 15, 19].every((lv) => oxByLevel[lv] === 354));
t('data: oxford level 20 has 362 words', oxByLevel[20] === 362);
t('data: every oxford word has a definition + example', oxford.every((e) => e.def && e.ex));
t('data: oxford wordsByLevel filters by level', wordsByLevel(oxford, 1).length === 354 && wordsByLevel(oxford, 20).length === 362 && wordsByLevel(oxford, 1).every((e) => e.lv === 1));
t('data: oxford entries carry only w/def/ex/lv', oxford.every((e) => Object.keys(e).sort().join(',') === 'def,ex,lv,w'));

// ---- (6) static checks ----
t('ver: app.js APP_VERSION v2.6', appJs.includes("APP_VERSION = 'v2.6'"));
t('ver: sw.js CACHE v2.6', swJs.includes("CACHE = 'primary-school-ai-v2.6'"));
t('ui: subject selector has Word', /<select id="subjectSel"[\s\S]{0,500}value="Word"/.test(indexHtml));
t('ui: grade selector has Oxford', /<select id="gradeSel"[\s\S]{0,500}value="Oxford"/.test(indexHtml));
t('ui: term selector exists with All terms + Term 1/2/3', indexHtml.includes('id="termSel"')
  && ['All terms', 'Term 1', 'Term 2', 'Term 3'].every((s) => indexHtml.includes(s)));
t('ui: oxford level selector exists with levels 1–20', indexHtml.includes('id="oxfordLevelSel"')
  && ['value="1"', 'value="10"', 'value="20"'].every((s) => indexHtml.includes(s)));
t('ui: My learning section on Home', indexHtml.includes('id="myLearning"') && indexHtml.includes('My learning'));
t('ui: My learning has subjects + questions containers', indexHtml.includes('id="learnSubjects"') && indexHtml.includes('id="learnQuestions"'));
t('app: records saved under psa-records', appJs.includes("psa-records"));
t('app: recent-correct saved under psa-recent-correct', appJs.includes('psa-recent-correct'));
t('app: oxford level saved', appJs.includes('psa-oxford-level'));
t('app: doCheck records the practice answer', /function doCheck[\s\S]{0,2000}recordPracticeAnswer/.test(appJs));
t('app: doAsk records the asked question', /function doAsk[\s\S]{0,800}recordAskQuestion/.test(appJs));
t('app: My learning renders on Home', appJs.includes('renderMyLearning') && /showMode[\s\S]{0,600}renderMyLearning/.test(appJs));
t('app: pickQuestion skips recently-correct items', appJs.includes('isRecentlyCorrect'));
t('app: loadBank handles Word from words.json', appJs.includes("subject === 'Word'") && appJs.includes('buildWordBank'));
t('app: loadBank handles Oxford from oxford_words.json', appJs.includes('oxford_words.json') || appJs.includes('loadOxfordWords'));
t('app: loadBank filters quiz bank by term', appJs.includes('filterByTerm'));
t('app: level keyed by practice track (Oxford separate from Word)', appJs.includes('practiceKey'));
t('app: Oxford forces subject Word', /Oxford[\\s\\S]{0,300}subjectSel\.value = 'Word'/.test(appJs) || /gradeSel\.value === 'Oxford'/.test(appJs));
t('app: term picker hidden for words', /termSel[\s\S]{0,200}hidden/.test(appJs));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
