// test_v2_6.mjs — Node verification for tutor v2.6 (sticky Practice
// pickers with a mid-quiz reload; second Next button + short labels
// Check/Next/Start; Noise selector shown only while Voice input is
// active; mic button renamed Speak -> Voice).
// Run from ~/workspace/primary-school-ai/work: node test_v2_6.mjs
//
// Covers (static checks on the shipped files — app.js is DOM-bound and
// cannot be imported in Node, as in test_v2_2–test_v2_5):
//   (1) version strings (APP_VERSION + SW cache bumped to v2.7; no
//       stale v2.6 version lines — the v2.2 lesson).
//   (2) sticky pickers: a picker bar that is a direct child of
//       practiceWrap (NOT inside the setup card — sticky is constrained
//       to its parent, so a bar inside the short card would scroll away
//       with it), above the Start card; CSS sticks it at top: 0 with an
//       opaque white background and a z-index.
//   (3) picker-change reload: one shared startPractice() path used by
//       the Start button and by grade/subject/term/level changes, and
//       only while a quiz is running (before Start, a change only
//       updates the picker interlock).
//   (4) second Next button in the question card, hidden until after
//       Check, wired to the same nextQuestion(); short labels.
//   (5) Noise row (selector + hint) hidden by default, toggled by the
//       listening state; mic button is Voice; sensitivity values and
//       the v2.3 migration untouched.
//   (6) NO kindergarten work: no KG grade in the Practice picker, no
//       KG entries added to data/words.json (cancelled by Won).
//
// What Node CANNOT test (parent verifies in the browser; Won's phone is
// the only proof for mic/TTS): the bar actually staying visible while
// scrolling a narrow phone screen, a picker change loading a new
// question from the new selection, the second Next button appearing
// after Check, the Noise row appearing on a Voice tap and hiding when
// voice input ends.
import fs from 'node:fs';

let pass = 0, fail = 0;
function t(name, cond, extra = '') {
  if (cond) { pass++; console.log(`PASS ${name}`); }
  else { fail++; console.log(`FAIL ${name} ${extra}`); }
}
const appJs = fs.readFileSync('../app.js', 'utf8');
const indexHtml = fs.readFileSync('../index.html', 'utf8');
const css = fs.readFileSync('../styles.css', 'utf8');
const swJs = fs.readFileSync('../sw.js', 'utf8');
const wordsJson = fs.readFileSync('../data/words.json', 'utf8');

// (1) version strings
t('ver: app.js APP_VERSION v2.7', appJs.includes("APP_VERSION = 'v2.7'"));
t('ver: sw.js CACHE v2.7', swJs.includes("CACHE = 'primary-school-ai-v2.7'"));
t('ver: no stale v2.6 version lines',
  !appJs.includes("APP_VERSION = 'v2.6'") && !swJs.includes("primary-school-ai-v2.6'"));

// (2) sticky pickers
const iWrap = indexHtml.indexOf('id="practiceWrap"');
const iBar = indexHtml.indexOf('id="practicePickers"');
const iCard = indexHtml.indexOf('<div class="card">', iWrap);
const iGrade = indexHtml.indexOf('id="gradeSel"');
const iLevel = indexHtml.indexOf('id="oxfordLevelSel"');
const iStart = indexHtml.indexOf('id="startBtn"');
const iQuiz = indexHtml.indexOf('id="quizWrap"');
t('sticky: picker bar exists', iBar > -1);
t('sticky: bar is a direct child of practiceWrap, above the setup card (not inside it)',
  iWrap > -1 && iWrap < iBar && iBar < iCard && iBar < iGrade && iGrade < iLevel && iLevel < iStart && iStart < iQuiz);
const stickyRule = /\.practice-pickers\s*\{([^}]*)\}/.exec(css);
t('sticky: CSS sticks the bar', !!stickyRule && /position:\s*sticky/.test(stickyRule[1]));
t('sticky: top 0, opaque white background, z-index',
  !!stickyRule && /top:\s*0/.test(stickyRule[1]) && /background:\s*#FFFFFF/.test(stickyRule[1]) && /z-index:\s*\d+/.test(stickyRule[1]));

// (3) picker-change reload
t('reload: shared startPractice() exists', appJs.includes('async function startPractice()'));
t('reload: Start button calls it', appJs.includes("els.startBtn.addEventListener('click', startPractice)"));
t('reload: old inline Start handler gone',
  !appJs.includes("els.startBtn.addEventListener('click', async () => {"));
t('reload: startPractice reloads the bank and resets quiz state',
  appJs.includes('await loadBank(els.gradeSel.value, els.subjectSel.value, els.termSel.value, oxfordLevel)')
  && appJs.includes('recentIds = [];') && appJs.includes('retryUnit = null;'));
t('reload: grade/subject/term pickers wired to the change handler',
  appJs.includes("els.gradeSel.addEventListener('change', onPracticePickerChange)")
  && appJs.includes("els.subjectSel.addEventListener('change', onPracticePickerChange)")
  && appJs.includes("els.termSel.addEventListener('change', onPracticePickerChange)"));
t('reload: oxford level change saves the level then calls the handler',
  appJs.includes("localStorage.setItem('psa-oxford-level', String(n))")
  && appJs.includes('onPracticePickerChange();'));
t('reload: change handler updates the interlock, then reloads only while a quiz is running',
  appJs.includes('function onPracticePickerChange()')
  && appJs.includes('if (!els.quizWrap.hidden) startPractice();'));

// (4) second Next button + short labels
t('next2: button exists in the question card, hidden, labelled Next',
  /id="nextBtn2"[^>]*hidden/.test(indexHtml) && indexHtml.includes('>Next</button>'));
t('next2: wired to the same nextQuestion()', appJs.includes("els.nextBtn2.addEventListener('click', nextQuestion)"));
t('next2: hidden in renderQuestion, shown in doCheck',
  appJs.includes('els.nextBtn2.hidden = true;') && appJs.includes('els.nextBtn2.hidden = false;'));
t('labels: Check (no "Check my answer" left)',
  indexHtml.includes('>Check</button>') && !indexHtml.includes('Check my answer'));
t('labels: Next on both buttons (no "Next question" left)',
  !indexHtml.includes('Next question') && (indexHtml.match(/>Next<\/button>/g) || []).length >= 2);
t('labels: Start (no "Start practising" left)',
  indexHtml.includes('>Start</button>') && !indexHtml.includes('Start practising'));

// (5) Noise only with Voice
t('noise: wrapper exists, hidden by default', /id="noiseRow"[^>]*hidden/.test(indexHtml));
t('noise: selector row and hint live inside the wrapper',
  indexHtml.indexOf('id="noiseRow"') > -1
  && indexHtml.indexOf('id="noiseRow"') < indexHtml.indexOf('id="sensHighBtn"')
  && indexHtml.indexOf('id="noiseRow"') < indexHtml.indexOf('Quiet place: Low.'));
t('noise: setListeningUI toggles the wrapper with the listening state',
  appJs.includes('els.noiseRow.hidden = !on;'));
t('noise: mic button is Voice (HTML + toggle)',
  indexHtml.includes('🎤 Voice') && !indexHtml.includes('🎤 Speak')
  && appJs.includes("'🎤 Voice'") && !appJs.includes("'🎤 Speak'"));
t('noise: sensitivity values and v2.3 migration untouched',
  appJs.includes('const SENSITIVITY = { low: 3, mid: 6, high: 10 };')
  && appJs.includes('legacySensitivityToNoiseLevel'));

// (6) NO kindergarten work (Won cancelled KG, 2026-11-25)
t('no-kg: Practice grade picker has no KG option',
  !/id="gradeSel"[\s\S]{0,400}value="KG"/.test(indexHtml));
t('no-kg: words.json unchanged by this version (no KG entries added)',
  !wordsJson.includes('"grade":"KG"') && !wordsJson.includes('"grade": "KG"'));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
