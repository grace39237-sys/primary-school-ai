// test_v2_4.mjs — Node verification for tutor v2.4 (choice-tap feedback,
// '**' markers stripped at display, 'More' button on the Ask answer card).
// Run from ~/workspace/primary-school-ai/work: node test_v2_4.mjs
//
// Covers:
//   (1) stripMarkdown (textutil.js, pure): the quiz data's own '**' style
//       ("The air feels **___**." / "The air feels **cold**.") is removed
//       at display; '___' blanks survive; math "3 * 4" is untouched.
//   (2) relatedHits (choices.js, pure): the other top hits from the same
//       Ask, excluding the chunk just answered, capped at 3.
//   (3) relatedWords (words.js, pure): other words in the same grade +
//       subject (same unit first), with fallbacks so a word answer almost
//       always has related items; the answered word itself is excluded.
//   (4) static checks — v2.4 version strings; the choice-tap feedback
//       wiring (selected state + disabled others + 'Thinking…' in the
//       answer area); the sanitizer applied at every display boundary
//       (answer, sources, board, choice labels, practice question/options);
//       the More button exists, is hidden by default in showAnswer, and
//       is only re-shown for a successful answer (never for a refusal).
//   (5) grade-first Ask retrieval (rag.js pure core + choices.js helper):
//       a selected grade searches its own chunks first; when nothing in
//       that grade scores >= 0.40 the all-grades search is used instead,
//       so a question taught in another grade still gets an answer.
//       The single-word lookup stays grade-agnostic (each word has
//       exactly one grade entry).
//
// What Node CANNOT test (parent verifies in the browser; Won's phone is
// the only proof for mic/TTS): the tap actually marking the button on a
// phone, the 'More' flow end to end, the model answering a related item,
// the grade selector changing a real answer's source grade.
import { stripMarkdown } from '../textutil.js';
import { relatedHits, gradeHitsUsable } from '../choices.js';
import { relatedWords } from '../words.js';
import { searchChunks } from '../retrieval.js';
import fs from 'node:fs';

let pass = 0, fail = 0;
function t(name, cond, extra = '') {
  if (cond) { pass++; console.log(`PASS ${name}`); }
  else { fail++; console.log(`FAIL ${name} ${extra}`); }
}
const appJs = fs.readFileSync('../app.js', 'utf8');
const boardJs = fs.readFileSync('../board.js', 'utf8');
const swJs = fs.readFileSync('../sw.js', 'utf8');
const indexHtml = fs.readFileSync('../index.html', 'utf8');

// ---- (1) stripMarkdown ----
t('md: **___** blank -> ___', stripMarkdown('The air feels **___**.') === 'The air feels ___.');
t('md: **cold** -> cold', stripMarkdown("The air feels **cold**.") === 'The air feels cold.');
t('md: full chunk example has no * left',
  !/\*/.test(stripMarkdown("Q: The air feels **___**. A: cold. The word is 'cold': The air feels **cold**.")));
t('md: full chunk example keeps the words',
  stripMarkdown("Q: The air feels **___**. A: cold. The word is 'cold': The air feels **cold**.")
    === "Q: The air feels ___. A: cold. The word is 'cold': The air feels cold.");
t('md: *italic* -> italic', stripMarkdown('The *cat* sat.') === 'The cat sat.');
t('md: `code` -> code', stripMarkdown('Say `hello`.') === 'Say hello.');
t('md: # heading -> plain', stripMarkdown('# Title\nBody text.') === 'Title\nBody text.');
t('md: plain text unchanged', stripMarkdown('A cloud is a mass of water droplets.') === 'A cloud is a mass of water droplets.');
t('md: bare ___ blank kept', stripMarkdown('Tom has ___ new toy car.') === 'Tom has ___ new toy car.');
t('md: math "3 * 4" untouched', stripMarkdown('What is 3 * 4?') === 'What is 3 * 4?');
t('md: "12 x 8" untouched', stripMarkdown('What is 12 x 8?') === 'What is 12 x 8?');
t('md: empty string stays empty', stripMarkdown('') === '');
t('md: null passes through', stripMarkdown(null) === null);
t('md: stray ** fragment removed', stripMarkdown('A **broken marker.') === 'A broken marker.');
t('md: stray backtick removed', stripMarkdown('Say `hello.') === 'Say hello.');

// ---- (2) relatedHits ----
const mkHit = (id) => ({ chunk: { id, source: `source ${id}` }, score: 0.9 - id * 0.01 });
const hits5 = [mkHit(1), mkHit(2), mkHit(3), mkHit(4), mkHit(5)];
t('rel: excludes the answered chunk', JSON.stringify(relatedHits(hits5, { id: 1 }).map((h) => h.chunk.id)) === '[2,3,4]');
t('rel: caps at 3', relatedHits(hits5, { id: 5 }).length === 3);
t('rel: keeps score order', JSON.stringify(relatedHits(hits5, { id: 2 }).map((h) => h.chunk.id)) === '[1,3,4]');
t('rel: answered chunk null -> first 3', JSON.stringify(relatedHits(hits5, null).map((h) => h.chunk.id)) === '[1,2,3]');
t('rel: empty hits -> []', relatedHits([], { id: 1 }).length === 0);
t('rel: single hit answered -> []', relatedHits([mkHit(1)], { id: 1 }).length === 0);
t('rel: hit without a chunk is skipped', relatedHits([null, mkHit(2)], { id: 9 }).length === 1);

// ---- (3) relatedWords ----
const fakeDict = {
  adding: { w: 'Adding', def: 'd1', ex: 'e1', grade: 'P1', subject: 'Vocabulary', unit: 'Numbers' },
  take: { w: 'Take', def: 'd2', ex: 'e2', grade: 'P1', subject: 'Vocabulary', unit: 'Numbers' },
  away: { w: 'Away', def: 'd3', ex: 'e3', grade: 'P1', subject: 'Vocabulary', unit: 'Numbers' },
  more: { w: 'More', def: 'd4', ex: 'e4', grade: 'P1', subject: 'Vocabulary', unit: 'Words' },
  big: { w: 'Big', def: 'd5', ex: 'e5', grade: 'P1', subject: 'Vocabulary', unit: 'Words' },
  noun: { w: 'Noun', def: 'd6', ex: 'e6', grade: 'P1', subject: 'English', unit: '' },
  verb: { w: 'Verb', def: 'd7', ex: 'e7', grade: 'P2', subject: 'English', unit: '' },
  rain: { w: 'Rain', def: 'd8', ex: 'e8', grade: 'P2', subject: 'Science', unit: '' },
};
const rw = (entry, n = 3) => relatedWords(fakeDict, entry, n).map((e) => e.w);
t('rw: same unit first, then same grade+subject',
  JSON.stringify(rw(fakeDict.adding)) === '["Take","Away","More"]');
t('rw: answered word itself excluded', !rw(fakeDict.adding).includes('Adding'));
t('rw: caps at 3', rw(fakeDict.adding).length === 3);
t('rw: empty unit -> grade+subject skipped, subject fallback then grade',
  JSON.stringify(rw(fakeDict.noun)) === '["Verb","Adding","Take"]');
t('rw: falls back to same subject, then same grade to fill the list',
  JSON.stringify(rw(fakeDict.verb)) === '["Noun","Rain"]');
t('rw: falls back to same grade across subjects',
  JSON.stringify(rw(fakeDict.rain)) === '["Verb"]');
t('rw: empty dict -> []', relatedWords({}, fakeDict.adding).length === 0);
t('rw: no duplicate labels', new Set(rw(fakeDict.adding, 5)).size === rw(fakeDict.adding, 5).length);

// ---- (4) static checks ----
t('ver: app.js APP_VERSION v2.7', appJs.includes("APP_VERSION = 'v2.7'"));
t('ver: sw.js CACHE v2.7', swJs.includes("CACHE = 'primary-school-ai-v2.7'"));
t('fb: chooseOne marks the tapped button', appJs.includes("aria-pressed', b === btn ? 'true' : 'false'"));
t('fb: chooseOne disables the other choices', /chooseOne[\s\S]{0,900}disabled = true/.test(appJs));
t('fb: chooseOne shows Thinking… in the answer area', /chooseOne[\s\S]{0,900}answerText\.textContent = 'Thinking…/.test(appJs));
t('fb: choices hidden only after the answer (finally)', /async function chooseOne[\s\S]{0,2000}finally\s*\{[\s\S]{0,200}hideChoices\(\)/.test(appJs));
t('md-use: showAnswer strips markdown', /function showAnswer[\s\S]{0,400}stripMarkdown\(/.test(appJs));
t('md-use: source list strips markdown', appJs.includes('stripMarkdown(s.chunk.source)'));
t('md-use: board strips markdown', boardJs.includes('stripMarkdown('));
t('md-use: choice labels stripped', /showChoiceObjects[\s\S]{0,600}stripMarkdown\(c\.label\)/.test(appJs) || /showChoices[\s\S]{0,600}stripMarkdown\(c\.label\)/.test(appJs));
t('md-use: practice question stripped', appJs.includes('stripMarkdown(item.question)'));
t('md-use: practice options stripped', appJs.includes('stripMarkdown(opt)'));
t('md-use: doCheck compares sanitized text', appJs.includes('stripMarkdown(b.textContent)') && appJs.includes('stripMarkdown(item.answer)'));
t('more: button in index.html', indexHtml.includes('id="moreBtn"'));
t('more: next to Listen/Copy', /speakBtn[\s\S]{0,200}moreBtn/.test(indexHtml));
t('more: hidden by default in showAnswer', /function showAnswer[\s\S]{0,900}moreBtn\.hidden = true/.test(appJs));
t('more: handler wired', appJs.includes("moreBtn.addEventListener('click'"));
t('more: relatedChoices helper exists', appJs.includes('relatedChoices'));
t('more: word answers reuse the word path', /chooseOne[\s\S]{0,900}c\.word/.test(appJs));
t('more: refusal never shows More (refuseAnswer has no updateMoreButton)', !/function refuseAnswer[\s\S]{0,200}updateMoreButton/.test(appJs));

// ---- (5) grade-first Ask retrieval ----
const synthChunks = [
  { grade: 'P3', scale: 1 }, { grade: 'P1', scale: 1 },
  { grade: 'P3', scale: 1 }, { grade: 'P5', scale: 1 },
];
// dim 2: chunk vectors [1,0] (score = q0), [0,1] (score = q1), [1,1]/2 (score ~ (q0+q1)/2, stored unnormalized here — the core uses raw dot*scale, so use exact values).
const synthVecs = new Int8Array([10, 0, 0, 10, 7, 7, 3, 3]);
const qv = new Float32Array([1, 0]); // scores: P3#0 = 10, P1#1 = 0, P3#2 = 7, P5#3 = 3
t('grade: unfiltered top-k by score',
  JSON.stringify(searchChunks(qv, synthChunks, synthVecs, 2, 3).map((h) => h.score)) === '[10,7,3]');
t('grade: grade filter keeps only that grade',
  JSON.stringify(searchChunks(qv, synthChunks, synthVecs, 2, 5, (c) => c.grade === 'P3').map((h) => h.score)) === '[10,7]');
t('grade: grade with no chunks -> []',
  searchChunks(qv, synthChunks, synthVecs, 2, 5, (c) => c.grade === 'KG').length === 0);
t('grade: k cap respected', searchChunks(qv, synthChunks, synthVecs, 2, 2).length === 2);
t('grade: pred sees the chunk', searchChunks(qv, synthChunks, synthVecs, 2, 5, (c) => c.grade === 'P5').length === 1);
t('grade: usable when best >= 0.40', gradeHitsUsable([{ score: 0.40, chunk: {} }]) === true);
t('grade: usable when best is higher', gradeHitsUsable([{ score: 0.65, chunk: {} }]) === true);
t('grade: not usable when best < 0.40', gradeHitsUsable([{ score: 0.39, chunk: {} }]) === false);
t('grade: not usable when empty', gradeHitsUsable([]) === false);
t('grade: not usable when null', gradeHitsUsable(null) === false);
t('grade: select exists in the Ask card', indexHtml.includes('id="askGradeSel"'));
t('grade: options are All grades + P1–P7 (KG removed, v2.6.1 — Won cancelled kindergarten)',
  ['value="all"', 'value="P1"', 'value="P3"', 'value="P7"'].every((o) => indexHtml.includes(o))
  && !indexHtml.includes('value="KG"'));
t('grade: same picker style as Practice (label wraps the select)',
  /picker-label[\s\S]{0,120}askGradeSel/.test(indexHtml));
t('grade: persisted in localStorage', appJs.includes("psa-ask-grade"));
t('grade: doAsk searches the grade first', appJs.includes('searchInGrade(qvec, askGrade, 5)'));
t('grade: falls back to all grades when not usable', /gradeHitsUsable\(hits\)[\s\S]{0,60}search\(qvec, 5\)/.test(appJs));
t('grade: word lookup stays grade-agnostic', appJs.includes('lookupWord(q, dict)') && !/showWordAnswer[\s\S]{0,400}askGrade/.test(appJs));
t('grade: retrieval.js in the SW shell', fs.readFileSync('../sw.js', 'utf8').includes("'./retrieval.js'"));

// ---- (6) header mode switcher ----
const stylesCss = fs.readFileSync('../styles.css', 'utf8');
t('top: Ask button in the header', /<header class="topbar">[\s\S]{0,600}id="topAskBtn"/.test(indexHtml));
t('top: Practise button in the header', /<header class="topbar">[\s\S]{0,600}id="topPracticeBtn"/.test(indexHtml));
t('top: labels are Ask / Practise', indexHtml.includes('💬 Ask') && indexHtml.includes('✏️ Practise'));
t('top: header buttons wired to showMode', appJs.includes("topAskBtn.addEventListener('click', () => showMode('ask'))") && appJs.includes("topPracticeBtn.addEventListener('click', () => showMode('practice'))"));
t('top: showMode marks the current mode', appJs.includes("topAskBtn.setAttribute('aria-pressed', String(mode === 'ask'))") && appJs.includes("topPracticeBtn.setAttribute('aria-pressed', String(mode === 'practice'))"));
t('top: topbar can wrap on a narrow phone', /\.topbar\s*\{[^}]*flex-wrap:\s*wrap/.test(stylesCss));
t('top: active header button has a visible style', /\.topbar[^{]*\.btn\[aria-pressed="true"\][^{]*\{[^}]*background:\s*#E8F5E9/.test(stylesCss));
t('top: home cards untouched', indexHtml.includes('id="askModeBtn"') && indexHtml.includes('id="practiceModeBtn"'));
t('top: Back buttons untouched', indexHtml.includes('id="askBackBtn"') && indexHtml.includes('id="practiceBackBtn"'));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
