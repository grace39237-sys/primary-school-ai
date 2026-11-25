// test_v2_6_1.mjs — Node verification for tutor v2.6.1 (KG removed from
// Ask + Oxford -> normal grade unfreezes the Practice pickers).
// Run from ~/workspace/primary-school-ai/work: node test_v2_6_1.mjs
//
// Covers:
//   (1) version strings (APP_VERSION + SW cache bumped to v2.7; no
//       stale v2.6 version lines — the v2.2 lesson).
//   (2) Bug 1 — KG gone from Ask (pickers.js, pure): a phone that saved
//       'KG' under v2.4 migrates to 'all' on load and the stored value is
//       rewritten; the Ask selector offers All grades + P1–P7 only; no
//       KG option anywhere in the HTML; the search core's KG comment is
//       gone (KG can no longer be selected).
//   (3) Bug 2 — Oxford -> P3 restores the pickers (pickers.js, pure):
//       entering Oxford records the subject it replaces; leaving Oxford
//       puts that subject back, re-enables Subject, hides the Level
//       picker, shows Term again; a deliberate Word pick (no Oxford
//       involved) is never clobbered; a level change while on Oxford
//       does not overwrite the saved subject. Static checks: app.js
//       applies the pure transition in updatePracticePickers, the change
//       handler runs the interlock before the mid-quiz reload (so the
//       restored subject is what loadBank reads), and pickers.js is in
//       the SW shell.
//   (4) No KG data added (carried from v2.6): words.json has no KG entries.
//
// What Node CANNOT test (Mu verifies in the browser): a saved 'KG' on a
// real phone falling back to All grades; Oxford -> P3 in the live app
// showing English enabled + Term visible + a normal English question.
import fs from 'node:fs';
import { migrateAskGrade, isValidAskGrade, nextPracticePickers } from '../pickers.js';

let pass = 0, fail = 0;
function t(name, cond, extra = '') {
  if (cond) { pass++; console.log(`PASS ${name}`); }
  else { fail++; console.log(`FAIL ${name} ${extra}`); }
}
const appJs = fs.readFileSync('../app.js', 'utf8');
const indexHtml = fs.readFileSync('../index.html', 'utf8');
const swJs = fs.readFileSync('../sw.js', 'utf8');
const ragJs = fs.readFileSync('../rag.js', 'utf8');
const wordsJson = fs.readFileSync('../data/words.json', 'utf8');

// (1) version strings
t('ver: app.js APP_VERSION v2.7', appJs.includes("APP_VERSION = 'v2.7'"));
t('ver: sw.js CACHE v2.7', swJs.includes("CACHE = 'primary-school-ai-v2.7'"));
t('ver: no stale v2.6 version lines',
  !appJs.includes("APP_VERSION = 'v2.6'") && !swJs.includes("CACHE = 'primary-school-ai-v2.6'"));

// (2) Bug 1 — KG gone from Ask
t('kg: saved KG migrates to all', migrateAskGrade('KG') === 'all');
t('kg: saved values pass through (all, P1, P7)',
  migrateAskGrade('all') === 'all' && migrateAskGrade('P1') === 'P1' && migrateAskGrade('P7') === 'P7');
t('kg: unknown/missing saved value falls back to all',
  migrateAskGrade(null) === 'all' && migrateAskGrade(undefined) === 'all'
  && migrateAskGrade('P9') === 'all' && migrateAskGrade('') === 'all');
t('kg: KG is not a valid Ask grade',
  isValidAskGrade('KG') === false && isValidAskGrade('all') === true
  && isValidAskGrade('P1') === true && isValidAskGrade('P7') === true
  && isValidAskGrade('P8') === false);
t('kg: Ask selector has no KG option',
  !/id="askGradeSel"[\s\S]{0,400}value="KG"/.test(indexHtml));
t('kg: no KG option anywhere in the HTML', !indexHtml.includes('value="KG"'));
t('kg: app.js loads the grade through the migration and rewrites a saved KG',
  appJs.includes('migrateAskGrade(g)') && appJs.includes("localStorage.setItem('psa-ask-grade', 'all')"));
t('kg: setAskGrade only accepts valid grades',
  appJs.includes('if (!isValidAskGrade(next)) return;'));
t('kg: search core no longer mentions KG', !ragJs.includes('KG'));

// (3) Bug 2 — Oxford -> normal grade restores the pickers
const enter = nextPracticePickers({ wasOxford: false, preOxfordSubject: 'English' }, 'Oxford', 'English');
t('oxford: entering Oxford forces Word, disables Subject, shows Level, hides Term',
  enter.subject === 'Word' && enter.subjectDisabled === true
  && enter.levelHidden === false && enter.termHidden === true
  && enter.wasOxford === true && enter.preOxfordSubject === 'English');
const leave = nextPracticePickers(enter, 'P3', 'Word');
t('oxford: Oxford -> P3 restores English, enables Subject, hides Level, shows Term',
  leave.subject === 'English' && leave.subjectDisabled === false
  && leave.levelHidden === true && leave.termHidden === false
  && leave.wasOxford === false);
const leaveFromWord = nextPracticePickers(
  nextPracticePickers({ wasOxford: false, preOxfordSubject: 'English' }, 'Oxford', 'Word'), 'P3', 'Word');
t('oxford: leaving Oxford from a Word pick restores Word (Term stays hidden)',
  leaveFromWord.subject === 'Word' && leaveFromWord.subjectDisabled === false
  && leaveFromWord.levelHidden === true && leaveFromWord.termHidden === true);
t('oxford: steady Word pick (no Oxford) is not clobbered, Term stays hidden',
  (() => {
    const s = nextPracticePickers({ wasOxford: false, preOxfordSubject: 'English' }, 'P3', 'Word');
    return s.subject === 'Word' && s.subjectDisabled === false && s.termHidden === true && s.levelHidden === true;
  })());
t('oxford: steady English pick shows Term',
  (() => {
    const s = nextPracticePickers({ wasOxford: false, preOxfordSubject: 'English' }, 'P3', 'English');
    return s.subject === 'English' && s.termHidden === false;
  })());
t('oxford: level change while on Oxford does not overwrite the saved subject',
  (() => {
    const s = nextPracticePickers(enter, 'Oxford', 'Word');
    return s.preOxfordSubject === 'English' && s.subject === 'Word';
  })());
t('oxford: app.js applies the pure transition in updatePracticePickers',
  appJs.includes('nextPracticePickers(pickerState, els.gradeSel.value, els.subjectSel.value)')
  && appJs.includes('els.subjectSel.value = next.subject')
  && appJs.includes('els.subjectSel.disabled = next.subjectDisabled')
  && appJs.includes('els.oxfordLevelSelWrap.hidden = next.levelHidden')
  && appJs.includes('els.termSelWrap.hidden = next.termHidden'));
t('oxford: change handler runs the interlock before the mid-quiz reload',
  (() => {
    const i = appJs.indexOf('function onPracticePickerChange()');
    return i > -1
      && appJs.indexOf('updatePracticePickers();', i) > -1
      && appJs.indexOf('updatePracticePickers();', i) < appJs.indexOf('startPractice();', i);
  })());
t('oxford: pickers.js imported by app.js and in the SW shell',
  appJs.includes("from './pickers.js'") && swJs.includes("'./pickers.js'"));

// (4) No KG data added
t('no-kg: words.json has no KG entries',
  !wordsJson.includes('"grade":"KG"') && !wordsJson.includes('"grade": "KG"'));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
