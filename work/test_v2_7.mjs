// test_v2_7.mjs — Node verification for tutor v2.7 (RAG index expanded
// with TWO new sources: DL daily lesson plans for teachers + full
// textbook lesson sentences).
// Run from ~/workspace/primary-school-ai/work: node test_v2_7.mjs
// Reads data/chunks.json as written by work/build_index.mjs
// (--skip-embed is enough; the full build writes the same file).
//
// Covers:
//   (1) version strings (APP_VERSION + SW cache bumped to v2.7).
//   (2) per-source counts: quiz 44,114 / word 1,677 / lesson 1,012 /
//       lesson-qa 7,030 / lesson-text 7,018 / dl 6,300 / TOTAL 67,151.
//       Quiz is 44,114, NOT the old 44,467: the master bank changed
//       (TU's 2026-11-24 math review: 348 deleted, 56 fixed, 5 merged)
//       and the v2.7 build re-copied it. If the bank changes again,
//       re-measure and bump these numbers (recount rule).
//   (3) chunk hygiene: no empty text anywhere; empty source only in
//       the 7 pre-existing lesson-qa defects (book practice answers
//       that are empty or literally 'undefined' — data defects, not
//       a build bug); lesson-text + dl ids unique; no KG anywhere.
//   (4) DL spot checks: 900 per grade; P1–P3 subjects are English /
//       Mathematics / Literacy I / Literacy II / News; P4–P7 are
//       English / Mathematics / Integrated Science / Social Studies /
//       Christian Religious Education; every DL text starts with its
//       header and carries an Objective; unit + id formats.
//   (5) lesson-text spot checks: text is '<title>. <sentence>',
//       source is the sentence, unit is the lesson title.
//   (6) build_index.mjs static checks: the DL + lesson-text sections
//       exist and read the Drive-latest DL files (never pilot1).
//
// What Node CANNOT test (parent verifies in the browser): a teacher
// question returning a DL chunk, 'What is photosynthesis?' returning
// textbook content, the 16-question Ask calibration vs the v2.4
// baseline, and the check-site serving the new index files.
import fs from 'node:fs';

let pass = 0, fail = 0;
function t(name, cond, extra = '') {
  if (cond) { pass++; console.log(`PASS ${name}`); }
  else { fail++; console.log(`FAIL ${name} ${extra}`); }
}
const appJs = fs.readFileSync('../app.js', 'utf8');
const swJs = fs.readFileSync('../sw.js', 'utf8');
const buildJs = fs.readFileSync('./build_index.mjs', 'utf8');
const chunks = JSON.parse(fs.readFileSync('../data/chunks.json', 'utf8'));

// (1) version strings
t('ver: app.js APP_VERSION v2.7', appJs.includes("APP_VERSION = 'v2.7'"));
t('ver: sw.js CACHE v2.7', swJs.includes("CACHE = 'primary-school-ai-v2.7'"));
t('ver: no stale v2.6 version lines',
  !appJs.includes("APP_VERSION = 'v2.6'") && !swJs.includes("primary-school-ai-v2.6'"));

// (2) per-source counts
const byKind = {};
for (const x of chunks) byKind[x.kind] = (byKind[x.kind] || 0) + 1;
t('count: TOTAL 67151', chunks.length === 67151, `got ${chunks.length}`);
t('count: quiz 44114', byKind.quiz === 44114, `got ${byKind.quiz}`);
t('count: word 1677', byKind.word === 1677, `got ${byKind.word}`);
t('count: lesson 1012', byKind.lesson === 1012, `got ${byKind.lesson}`);
t('count: lesson-qa 7030', byKind['lesson-qa'] === 7030, `got ${byKind['lesson-qa']}`);
t('count: lesson-text 7018', byKind['lesson-text'] === 7018, `got ${byKind['lesson-text']}`);
t('count: dl 6300', byKind.dl === 6300, `got ${byKind.dl}`);

// (3) chunk hygiene
const emptyText = chunks.filter((x) => !x.text || !x.text.trim());
t('hygiene: no empty text', emptyText.length === 0, `got ${emptyText.length}`);
const emptySrc = chunks.filter((x) => !x.source || !x.source.trim());
t('hygiene: empty source is exactly the 7 pre-existing lesson-qa defects',
  emptySrc.length === 7 && emptySrc.every((x) => x.kind === 'lesson-qa'),
  `got ${emptySrc.length}: ${emptySrc.map((x) => `${x.kind}/${x.unit}`).join('; ')}`);
const noId = chunks.filter((x) => !x.id);
t('hygiene: every chunk has an id', noId.length === 0, `got ${noId.length}`);
const undef = chunks.filter((x) => x.text === undefined || x.source === undefined || x.kind === undefined || x.grade === undefined || x.subject === undefined || x.unit === undefined);
t('hygiene: undefined fields only in the same 7 lesson-qa defects (practice answer missing in the book data → source undefined, text shows "A: undefined")',
  undef.length === 7 && undef.every((x) => x.kind === 'lesson-qa' && x.source === undefined),
  `got ${undef.length}`);
const grades = new Set(chunks.map((x) => x.grade));
t('hygiene: grades are P1–P7 only, no KG',
  [...grades].every((g) => /^P[1-7]$/.test(g)) && !grades.has('KG'),
  `got ${[...grades].join(',')}`);
function uniqueIds(kind) {
  const ids = chunks.filter((x) => x.kind === kind).map((x) => x.id);
  return new Set(ids).size === ids.length;
}
t('hygiene: lesson-text ids unique', uniqueIds('lesson-text'));
t('hygiene: dl ids unique', uniqueIds('dl'));

// (4) DL spot checks
const dl = chunks.filter((x) => x.kind === 'dl');
const perGrade = {};
for (const x of dl) perGrade[x.grade] = (perGrade[x.grade] || 0) + 1;
t('dl: 900 per grade, P1–P7',
  ['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7'].every((g) => perGrade[g] === 900),
  JSON.stringify(perGrade));
const subj = (gs) => [...new Set(dl.filter((x) => gs.includes(x.grade)).map((x) => x.subject))].sort();
t('dl: P1–P3 subjects are English/Math/Literacy I/Literacy II/News',
  JSON.stringify(subj(['P1', 'P2', 'P3'])) === JSON.stringify(['English', 'Literacy I', 'Literacy II', 'Mathematics', 'News']),
  JSON.stringify(subj(['P1', 'P2', 'P3'])));
t('dl: P4–P7 subjects are English/Math/Integrated Science/Social Studies/CRE',
  JSON.stringify(subj(['P4', 'P5', 'P6', 'P7'])) === JSON.stringify(['Christian Religious Education', 'English', 'Integrated Science', 'Mathematics', 'Social Studies']),
  JSON.stringify(subj(['P4', 'P5', 'P6', 'P7'])));
t('dl: every text starts with its header (grade + subject + Term)',
  dl.every((x) => x.text.startsWith(`${x.grade} ${x.subject} Term `)));
t('dl: every text carries an Objective',
  dl.every((x) => x.text.includes('Objective:')));
t('dl: unit format "Term N · Week W Day D · theme"',
  dl.every((x) => /^Term [123] · Week \d+ Day \d+ · .+/.test(x.unit)));
t('dl: id format DL-Pn-Tn-Subject-WwwDdd',
  dl.every((x) => /^DL-P[1-7]-T[123]-\S+-W\d{2}D\d{2}$/.test(x.id)));
const dlP3 = dl.find((x) => x.grade === 'P3' && x.subject === 'English' && x.unit.includes('Week 2'));
t('dl: P3 English Term 1 Week 2 chunk exists with activities',
  !!dlP3 && dlP3.text.includes('Activities:') && dlP3.text.includes('Materials:'),
  dlP3 ? dlP3.unit : 'missing');

// (5) lesson-text spot checks
const lt = chunks.filter((x) => x.kind === 'lesson-text');
t('lt: every text is "<title>. <sentence>"',
  lt.every((x) => x.text.startsWith(`${x.unit}. `)));
t('lt: source is the sentence (text ends with source)',
  lt.every((x) => x.text.endsWith(x.source)));
t('lt: grades P1–P7 only',
  [...new Set(lt.map((x) => x.grade))].every((g) => /^P[1-7]$/.test(g)));
const ltPhoto = lt.filter((x) => /photosynth/i.test(x.text));
t('lt: photosynthesis sentences present (textbook content)',
  ltPhoto.length >= 2, `got ${ltPhoto.length}`);

// (6) build script static checks
t('build: DL section reads the Drive-latest files',
  buildJs.includes('DailyLesson.drive.jsonl'));
t('build: no pilot1 file is ever read (the comment only warns against it)',
  !buildJs.includes('pilot1.jsonl'));
t('build: lesson-text section exists',
  buildJs.includes("kind: 'lesson-text'"));
t('build: DL chunk kind exists',
  buildJs.includes("kind: 'dl'"));
t('build: DL condensed text documented (full text would exceed GitHub 100MB)',
  buildJs.includes('100 MB'));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
