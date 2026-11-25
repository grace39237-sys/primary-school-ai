// test_v2_2.mjs — Node verification for tutor v2.2.
// Run from ~/workspace/primary-school-ai/work: node test_v2_2.mjs
//
// Covers:
//   (1) band classification at the boundaries (0.39 refuse, 0.40 choices,
//       0.66 choices, 0.67 direct).
//   (2) choice labels — grounded text only (the chunk's own question,
//       word, or unit title), capped at 90 chars, case kept.
//   (3) distinctChoices — same-label chunks dedupe, the next distinct
//       hit fills the slot, at most 3, fewer when the index has fewer.
//   (4) static checks — v2.2 version strings, thresholds wired through
//       classifyBand (no direct score comparison left), choices UI present,
//       duplicated Practice steps list gone, "Say it simpler" now targets
//       the board, all element IDs exist.
//
// The live-browser check (parent) is the real proof for the browser path;
// mic recording and TTS sound cannot be verified in a cloud browser at all.
import { classifyBand, choiceLabel, distinctChoices, dedupKey, DIRECT_THRESHOLD, REFUSAL_THRESHOLD } from '../choices.js';
import fs from 'node:fs';

let pass = 0, fail = 0;
function t(name, cond, extra = '') {
  if (cond) { pass++; console.log(`PASS ${name}`); }
  else { fail++; console.log(`FAIL ${name} ${extra}`); }
}

// ---- (1) bands ----
t('band: thresholds are 0.40 / 0.67 (Won)', REFUSAL_THRESHOLD === 0.40 && DIRECT_THRESHOLD === 0.67);
t('band: 0.39 -> refuse', classifyBand(0.39) === 'refuse');
t('band: 0.40 -> choices', classifyBand(0.40) === 'choices');
t('band: 0.66 -> choices', classifyBand(0.66) === 'choices');
t('band: 0.67 -> direct', classifyBand(0.67) === 'direct');
t('band: 0.0 -> refuse', classifyBand(0) === 'refuse');
t('band: 1.0 -> direct', classifyBand(1.0) === 'direct');
t('band: NaN -> refuse', classifyBand(NaN) === 'refuse');
t('band: undefined -> refuse', classifyBand(undefined) === 'refuse');

// ---- (2) choice labels (grounded only) ----
const qaChunk = { kind: 'lesson-qa', id: 'LQ-P1-Science-Rain', text: 'Q: How are clouds made? A: Water vapour condenses high in the sky.', source: 'Water vapour condenses high in the sky.', unit: 'Rain' };
const quizChunk = { kind: 'quiz', id: 'TH4158019', text: "Q: What does 'cloud' mean? A: A mass of water droplets in the sky.", source: "'cloud' means mass of water droplets in the sky.", unit: 'Weather' };
const wordChunk = { kind: 'word', id: 'CW-P3-Cloud', text: 'Cloud: a group of water drops in the sky. Example: A cloud floats.', source: 'a group of water drops in the sky.', unit: '' };
const lessonChunk = { kind: 'lesson', id: 'L-P3-Social-How Plants Grow', text: 'How Plants Grow. A seed needs water...', source: 'A seed needs water, sunlight, soil and care.', unit: 'How Plants Grow' };
t('label: lesson-qa uses its own question', choiceLabel(qaChunk) === 'How are clouds made?');
t('label: quiz uses its own question', choiceLabel(quizChunk) === "What does 'cloud' mean?");
t('label: word uses the word', choiceLabel(wordChunk) === 'Cloud');
t('label: lesson uses the unit title', choiceLabel(lessonChunk) === 'How Plants Grow');
t('label: empty chunk falls back, never invented', choiceLabel({}) === 'From the book');
t('label: long question capped at 90 chars', choiceLabel({ kind: 'quiz', text: `Q: ${'x'.repeat(200)}? A: yes.`, source: 'yes.' }).length <= 90);
t('label: long label ends with an ellipsis, not mid-word', choiceLabel({ kind: 'quiz', text: 'Q: What is it costs sh. 11,000 for one person to travel from Kampala to Mbale if 5 people are travelling together by bus? A: 55,000.', source: '55,000.' }).endsWith('…'));
t('label: no invented wording — label comes from chunk text',
  choiceLabel(qaChunk).includes('clouds') && choiceLabel(quizChunk).includes('cloud'));

// ---- (3) distinctChoices ----
const qaDup = { kind: 'lesson-qa', id: 'LQ-P1-English-A Rainy Day', text: 'Q: How are clouds made? A: Clouds form when water vapour cools.', source: 'Clouds form when water vapour cools.', unit: 'A Rainy Day' };
const hits = [
  { chunk: qaChunk, score: 0.64 },
  { chunk: qaDup, score: 0.61 }, // same question as qaChunk -> deduped
  { chunk: quizChunk, score: 0.58 },
  { chunk: wordChunk, score: 0.55 },
  { chunk: lessonChunk, score: 0.50 },
];
const three = distinctChoices(hits, 3);
t('choices: returns 3', three.length === 3, JSON.stringify(three.map((c) => c.label)));
t('choices: duplicate question deduped, next distinct fills the slot',
  three[0].label === 'How are clouds made?' && three[1].label === "What does 'cloud' mean?" && three[2].label === 'Cloud',
  JSON.stringify(three.map((c) => c.label)));
t('choices: labels stay in score order', three[0].score > three[1].score && three[1].score > three[2].score);
t('choices: fewer hits -> fewer choices', distinctChoices([hits[0]], 3).length === 1);
t('choices: empty hits -> empty', distinctChoices([], 3).length === 0 && distinctChoices(null, 3).length === 0);
t('choices: each choice keeps its chunk (answer source)', three.every((c) => c.chunk && c.chunk.source));
const blankA = { kind: 'quiz', id: 'B1', text: 'Q: Study the diagram. Name the state labeled Q: ____. A: gas.', source: 'gas.' };
const blankB = { kind: 'quiz', id: 'B2', text: 'Q: Study the diagram. Name the state labeled Q: ___. A: gas.', source: 'gas.' };
t('choices: labels differing only in blanks dedupe to one',
  distinctChoices([{ chunk: blankA, score: 0.5 }, { chunk: blankB, score: 0.49 }, { chunk: wordChunk, score: 0.48 }], 3).length === 2);
// v2.2 fix (Bug 2): "What falls from the cloud?" and "What falls from
// clouds?" are the same choice for a child — singular vs plural must
// collapse so the next distinct chunk fills the slot.
const cloudA = { kind: 'quiz', id: 'C1', text: 'Q: What falls from the cloud? A: Rain.', source: 'Rain falls from clouds.', unit: 'Weather' };
const cloudB = { kind: 'quiz', id: 'C2', text: 'Q: What falls from clouds? A: Rain.', source: 'Rain falls from clouds.', unit: 'Weather' };
t('dedup: cloud vs clouds share one key',
  dedupKey('What falls from the cloud?') === dedupKey('What falls from clouds?'));
t('dedup: key is lowercase, punctuation-free, whitespace-collapsed, articles dropped',
  dedupKey('  What   Falls, From the Cloud? ') === 'whatfallsfromcloud');
t('dedup: singularize guards keep glass / gas / this intact',
  dedupKey('glass') === 'glass' && dedupKey('gas') === 'gas' && dedupKey('this') === 'this');
t('choices: cloud/clouds pair counts once, next distinct fills the slot',
  (() => {
    const got = distinctChoices([
      { chunk: cloudA, score: 0.6 }, { chunk: cloudB, score: 0.59 },
      { chunk: quizChunk, score: 0.58 }, { chunk: wordChunk, score: 0.55 },
    ], 3);
    return got.length === 3 && got[0].label === 'What falls from the cloud?'
      && got[1].label === "What does 'cloud' mean?" && got[2].label === 'Cloud';
  })(), JSON.stringify(distinctChoices([
    { chunk: cloudA, score: 0.6 }, { chunk: cloudB, score: 0.59 },
    { chunk: quizChunk, score: 0.58 }, { chunk: wordChunk, score: 0.55 },
  ], 3).map((c) => c.label)));

// ---- (4) static checks ----
const appSrc = fs.readFileSync('../app.js', 'utf8');
const html = fs.readFileSync('../index.html', 'utf8');
const css = fs.readFileSync('../styles.css', 'utf8');
const swSrc = fs.readFileSync('../sw.js', 'utf8');
t('static: app version is v2.4', appSrc.includes("APP_VERSION = 'v2.4'")); // bumped 2026-11-25: v2.4 (was v2.3; v2.2.1 before that, so the browser fetches the fix, not a stale shell)
t('static: bands go through classifyBand', appSrc.includes('classifyBand(best'));
t('static: no direct score comparison left in doAsk',
  !appSrc.includes('best.score <') && !appSrc.includes('best.score >'));
t('static: choices UI wired', appSrc.includes('showChoices') && appSrc.includes('chooseOne') && appSrc.includes('choiceNoneBtn'));
t('static: answer-from-choice uses the picked chunk text',
  appSrc.includes('c.chunk.text || c.chunk.source'));
t('static: no leftover quizSteps / simplerText references',
  !appSrc.includes('quizSteps') && !appSrc.includes('simplerText') && !html.includes('quizSteps') && !html.includes('simplerText'));
t('static: choices section present with grounded prompt',
  html.includes('id="choiceWrap"') && html.includes('Which one did you mean?') && html.includes('None of these — ask again'));
t('static: practice steps live only on the board',
  appSrc.includes('practiceBoard.show(steps)') && !appSrc.includes("els.quizSteps"));
t('static: Say it simpler writes to the board', appSrc.includes('practiceBoard.show(steps)') && appSrc.includes('saySimpler'));
t('static: Say it simpler sends the full steps, guarded, with fallback',
  appSrc.includes('stepsOf(current.item)') && appSrc.includes('simplerBoardSteps(text, steps)')
  && appSrc.includes('simple.length ? simple : steps'));
t('static: simpler prompt forbids greeting, asks for a rewrite',
  fs.readFileSync('../ai.js', 'utf8').includes('Do not greet the child')
  && fs.readFileSync('../ai.js', 'utf8').includes('Text to rewrite:'));
const ids = [...appSrc.matchAll(/\$\('([A-Za-z0-9_]+)'\)/g)].map((m) => m[1]);
const missing = [...new Set(ids)].filter((id) => !html.includes(`id="${id}"`));
t('static: all app.js element IDs exist in index.html', missing.length === 0, `missing: ${missing.join(', ')}`);
t('static: sw cache is v2.4', swSrc.includes("primary-school-ai-v2.4")); // bumped 2026-11-25: same reason as the app version above
t('static: sw lists choices.js in the shell', swSrc.includes("'./choices.js'"));
t('static: sw never deletes transformers-cache', swSrc.includes("k.startsWith('primary-school-ai-')") && !swSrc.includes("caches.delete('transformers-cache')"));
t('static: choice title styled, orphaned step rules gone',
  css.includes('.choice-title') && !css.includes('.steps-list') && !css.includes('.steps-title') && !css.includes('.simpler-text'));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
