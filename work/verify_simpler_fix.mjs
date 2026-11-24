// verify_simpler_fix.mjs — end-to-end check of the Bug 1 fix with the
// REAL 135M int8 model: the NEW prompt from ai.js + the guard from
// practice.js, on the two browser-reported step sets (plus rain + LCM).
// Run from ~/workspace/primary-school-ai/work: node verify_simpler_fix.mjs
//
// The prompt strings below are verbatim copies of ai.js SYSTEM_SIMPLE
// and the saySimpler user message (test_v2_2.mjs statically asserts
// ai.js contains them). ai.js itself cannot be imported in Node — the
// vendored browser bundle throws at import time.
import { pipeline, env } from '@huggingface/transformers';
import { simplerBoardSteps } from '../practice.js';

env.cacheDir = '/home/hatch/workspace/offline-translator/work/.cache';
env.allowLocalModels = false;

const SYSTEM_SIMPLE = 'You are a friendly teacher for primary school children in Uganda. Rewrite the text below in 1 or 2 short, simple English sentences a young child can understand. Start with the rewritten text. Do not greet the child. Do not ask a question. Use ONLY the information given. Do not add facts.';

const CASES = [
  {
    id: 'P131140008 (REPORTED CASE, P1 English)',
    steps: ['Hint: The most: smarter or smartest?', 'smart - smarter - smartest.'],
    key: ['smartest'],
  },
  {
    id: 'P614111031 (P6 Science, snail)',
    steps: ['Hint: It carries its house on its back.', 'The animal in the diagram with a coiled shell is a snail, which is a mollusc.'],
    key: ['snail', 'mollusc', 'shell'],
  },
  {
    id: 'P414010051 (P4 Science, rain)',
    steps: ['Hint: Water rises as vapour, then forms clouds.', 'Water evaporates into vapour, then condenses into clouds that bring rain.'],
    key: ['cloud', 'rain'],
  },
  {
    id: 'P412040016 (P4 Math, LCM)',
    steps: ['Hint: List multiples of each until one matches.', 'Multiples of 6: 6, 12, 18; multiples of 9: 9, 18.', 'The smallest common one is 18.'],
    key: ['18', 'multiple'],
  },
];

const gen = await pipeline('text-generation', 'onnx-community/SmolLM2-135M-Instruct-ONNX', { dtype: 'q8' });

let bad = 0;
for (const c of CASES) {
  const out = await gen([
    { role: 'system', content: SYSTEM_SIMPLE },
    { role: 'user', content: `Text to rewrite: ${c.steps.join(' ')}` },
  ], { max_new_tokens: 80, do_sample: false });
  const msgs = out[0].generated_text;
  const last = msgs[msgs.length - 1];
  const modelText = (last && last.role === 'assistant' ? last.content : msgs.map((m) => m.content).join(' ')).trim();
  const simple = simplerBoardSteps(modelText, c.steps);
  const board = simple.length ? simple : c.steps; // app.js handler logic
  const joined = board.join(' ').toLowerCase();
  const hasKey = c.key.some((k) => joined.includes(k));
  const isFallback = simple.length === 0;
  const shorter = board.join(' ').length < c.steps.join(' ').length;
  console.log(`\n[${c.id}]`);
  console.log(`  model: ${JSON.stringify(modelText)}`);
  console.log(`  board (${isFallback ? 'FALLBACK to original steps' : 'simpler rewording'}): ${JSON.stringify(board)}`);
  console.log(`  keeps key words: ${hasKey} | shorter than original: ${shorter}`);
  if (!hasKey) { bad++; console.log('  ^^ FAIL: key content word lost'); }
}
console.log(`\n${bad ? `${bad} case(s) lost key content` : 'all cases keep their key content words'}`);
process.exit(bad ? 1 : 0);
