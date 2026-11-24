// test_v2_1.mjs — Node verification for tutor v2.1.
// Run from ~/workspace/primary-school-ai/work: node test_v2_1.mjs
//
// Covers:
//   (1) word lookup (words.js + data/words.json) — "noun" must resolve,
//       plurals must resolve, non-words must miss (they go to RAG/refusal).
//   (2) VAD calibration (vad.js) — loud first frames must NOT inflate the
//       noise baseline; speech right after mic-on must be heard; the 3s
//       fallback must complete calibration; sensitivity changes the threshold.
//   (3) static checks — no auto-play left (board.js), old 'psa-listen' key
//       never read (app.js), all element IDs exist (index.html).
//
// The live-browser check (parent) is the real proof for the browser path;
// mic recording and TTS sound cannot be verified in a cloud browser at all.
import { lookupWord } from '../words.js';
import { VoiceCapture } from '../vad.js';
import fs from 'node:fs';

let pass = 0, fail = 0;
function t(name, cond, extra = '') {
  if (cond) { pass++; console.log(`PASS ${name}`); }
  else { fail++; console.log(`FAIL ${name} ${extra}`); }
}

const words = JSON.parse(fs.readFileSync('../data/words.json', 'utf8'));

// ---- (1) word lookup ----
const noun = lookupWord('noun', words);
t('lookup: noun resolves', !!noun && noun.def.includes('naming word'), JSON.stringify(noun));
t('lookup: noun is P3 English Nouns', !!noun && noun.grade === 'P3' && noun.subject === 'English' && noun.unit === 'Nouns');
t('lookup: Noun (capital) resolves', !!lookupWord('Noun', words));
t('lookup: nouns resolves to its own P5 entry (exact match wins)', lookupWord('nouns', words)?.w === 'Nouns');
t('lookup: giraffes (plural) resolves to giraffe', lookupWord('giraffes', words)?.w === 'giraffe');
t('lookup: pencils (plural) resolves to pencil', lookupWord('pencils', words)?.w === 'Pencil');
t('lookup: head teacher (two words) resolves', !!lookupWord('head teacher', words));
t('lookup: giraffe resolves', !!lookupWord('giraffe', words));
t('lookup: quantum physics misses (goes to RAG, refuses)', lookupWord('quantum physics', words) === null);
t('lookup: xyzzy misses', lookupWord('xyzzy', words) === null);
t('lookup: full question misses (goes to RAG)', lookupWord('What is a noun?', words) === null);
t('lookup: no markdown ** anywhere in word data',
  !Object.values(words).some((e) => (e.def + (e.ex || '')).includes('**')));
t('lookup: 3000+ entries', Object.keys(words).length >= 3000, `got ${Object.keys(words).length}`);

// ---- (2) VAD calibration ----
// _onSample is fed directly (no mic, no AudioContext); state is reset
// with _resetState(), the same init start() runs in the app.
function freshCapture(opts) {
  const c = new VoiceCapture(opts);
  c._resetState();
  return c;
}
function feedFrames(c, energies) {
  // One frame = 1600 samples; constant amplitude sqrt(energy) gives that energy.
  for (const e of energies) {
    const amp = Math.sqrt(e);
    for (let i = 0; i < 1600; i++) c._onSample(amp);
  }
}

// A: loud first frames must NOT enter the baseline.
{
  const c = freshCapture({ onUtterance: () => {} });
  feedFrames(c, [0.01, 0.01, 0.01, 0.01, 0.01]); // 5 loud frames (speech right after mic-on)
  feedFrames(c, Array(10).fill(0.0001)); // 10 quiet frames
  t('vad: loud first frames excluded from baseline', c.noiseFloor !== null && c.noiseFloor < 0.0002, `noiseFloor=${c.noiseFloor}`);
  // B: speech right after mic-on is heard (old code went deaf here).
  let heard = false;
  c.onSpeechStart = () => { heard = true; };
  feedFrames(c, [0.001]); // voice energy, well above 0.0001 x 6 = 0.0006
  t('vad: speech after loud start is heard', c.speaking === true && heard === true);
}

// C: 3s fallback — 30 loud frames, no quiet ones: calibration still completes.
{
  const c = freshCapture({ onUtterance: () => {} });
  feedFrames(c, Array(30).fill(0.01));
  t('vad: 3s fallback sets a baseline', c.noiseFloor !== null && Math.abs(c.noiseFloor - 0.01) < 1e-9, `noiseFloor=${c.noiseFloor}`);
}

// D: sensitivity changes the threshold (mid x6 vs low x10).
{
  const mid = freshCapture({ onUtterance: () => {}, sensitivity: 6 });
  feedFrames(mid, Array(10).fill(0.0001));
  feedFrames(mid, [0.0004]); // 0.0004 < 0.0001 x 6 = 0.0006: mid ignores
  const midIgnores = !mid.speaking;
  const low = freshCapture({ onUtterance: () => {}, sensitivity: 10 });
  feedFrames(low, Array(10).fill(0.0001));
  feedFrames(low, [0.0008]); // 0.0008 > 0.0006 (mid would hear) but < 0.001 (low ignores)
  const lowIgnores = !low.speaking;
  const mid2 = freshCapture({ onUtterance: () => {}, sensitivity: 6 });
  feedFrames(mid2, Array(10).fill(0.0001));
  feedFrames(mid2, [0.0008]);
  t('vad: mid (x6) hears 0.0008, low (x10) ignores it', mid2.speaking === true && lowIgnores === true, `mid=${mid2.speaking} low-ignores=${lowIgnores}`);
  t('vad: mid (x6) ignores 0.0004', midIgnores === true);
  const high = freshCapture({ onUtterance: () => {}, sensitivity: 3 });
  feedFrames(high, Array(10).fill(0.0001));
  feedFrames(high, [0.0004]); // 0.0004 > 0.0001 x 3 = 0.0003: high hears
  t('vad: high (x3) hears 0.0004', high.speaking === true);
}

// E: full utterance — speech then silence emits, onSpeechEnd fires.
{
  let emitted = null, ended = false;
  const c = freshCapture({
    onUtterance: (a) => { emitted = a; },
    onSpeechEnd: () => { ended = true; },
  });
  feedFrames(c, Array(10).fill(0.0001)); // calibrate
  feedFrames(c, Array(6).fill(0.002)); // ~0.6s of speech
  feedFrames(c, Array(9).fill(0.0001)); // 0.9s silence ends it
  t('vad: utterance emitted after silence', emitted !== null && emitted.length > 16000 * 0.4, `len=${emitted?.length}`);
  t('vad: onSpeechEnd fired', ended === true);
}

// ---- (3) static checks ----
const boardSrc = fs.readFileSync('../board.js', 'utf8');
t('static: board has speakSteps (Listen reads on tap)', boardSrc.includes('speakSteps'));
t('static: board show() does not speak (no auto-play)',
  !/function show\(steps\)[\s\S]*?speak\(/.test(boardSrc.split('async function speakSteps')[0]));
t('static: board has no listen toggle state', !boardSrc.includes('setListen') && !boardSrc.includes('getListen'));
const appSrc = fs.readFileSync('../app.js', 'utf8');
t('static: app never reads old psa-listen key (only a comment mentions it)', !appSrc.includes("getItem('psa-listen')"));
t('static: app wires word lookup', appSrc.includes('lookupWord') && appSrc.includes('loadWords'));
t('static: app wires sensitivity', appSrc.includes('psa-sensitivity') && appSrc.includes('onSpeechStart'));
const html = fs.readFileSync('../index.html', 'utf8');
const ids = [...appSrc.matchAll(/\$\('([A-Za-z0-9_]+)'\)/g)].map((m) => m[1]);
const missing = [...new Set(ids)].filter((id) => !html.includes(`id="${id}"`));
t('static: all app.js element IDs exist in index.html', missing.length === 0, `missing: ${missing.join(', ')}`);
const swSrc = fs.readFileSync('../sw.js', 'utf8');
t('static: sw cache is v2.1', swSrc.includes("primary-school-ai-v2.1"));
t('static: sw never deletes transformers-cache', swSrc.includes("k.startsWith('primary-school-ai-')") && !swSrc.includes("caches.delete('transformers-cache')"));
t('static: app version is v2.1', appSrc.includes("APP_VERSION = 'v2.1'"));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
