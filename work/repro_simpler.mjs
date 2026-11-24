// repro_simpler.mjs — reproduce Bug 1 ("Say it simpler" shows a greeting
// instead of a simpler rewording) with the EXACT prompt the app sends,
// then try prompt variants. Run from ~/workspace/primary-school-ai/work:
//   node repro_simpler.mjs
//
// The app (ai.js saySimpler) sends, verbatim:
//   system: SYSTEM_SIMPLE (copied below)
//   user:   `Information: ${information}`   where information is ONLY
//           item.explanation (app.js simpler handler) — NOT the hint,
//           NOT the question, NOT the full steps.
//   generation: max_new_tokens 80, do_sample false (greedy), dtype 'q8'.
// The vendored browser bundle cannot run in Node, so this uses the npm
// build of the identical library version (3.8.1) and the same weights.
import { pipeline, env } from '@huggingface/transformers';

env.cacheDir = '/home/hatch/workspace/offline-translator/work/.cache';
env.allowLocalModels = false;

const SYSTEM_SIMPLE = 'You are a friendly teacher for primary school children in Uganda. Say the information below again in 1 or 2 short, simple English sentences a young child can understand. Use ONLY the information given. Do not add facts.';

const SYSTEM_REWRITE = 'You are a friendly teacher for primary school children in Uganda. Rewrite the text below in 1 or 2 short, simple English sentences a young child can understand. Start with the rewritten text. Do not greet the child. Do not ask a question. Use ONLY the information given. Do not add facts.';

// Real step sets from the quiz bank (stepsOf shape: hint first, then
// explanation split into sentences).
const CASES = [
  {
    id: 'P131140008 (REPORTED CASE, P1 English)',
    question: 'Smart, smarter, ___',
    answer: 'smartest',
    steps: ['Hint: The most: smarter or smartest?', 'smart - smarter - smartest.'],
    key: ['smartest'],
  },
  {
    id: 'P614111031 (P6 Science, snail)',
    question: 'Name the mollusc in the diagram below: ____',
    answer: 'Snail',
    steps: ['Hint: It carries its house on its back.', 'The animal in the diagram with a coiled shell is a snail, which is a mollusc.'],
    key: ['snail', 'mollusc', 'shell'],
  },
  {
    id: 'P414010051 (P4 Science, rain)',
    question: 'Write any two processes involved in the formation of rain.',
    answer: 'evaporation; condensation',
    steps: ['Hint: Water rises as vapour, then forms clouds.', 'Water evaporates into vapour, then condenses into clouds that bring rain.'],
    key: ['cloud', 'rain', 'vapour'],
  },
  {
    id: 'P412040016 (P4 Math, LCM)',
    question: 'Find the Lowest Common Multiple (LCM) of 6 and 9.',
    answer: '18',
    steps: ['Hint: List multiples of each until one matches.', 'Multiples of 6: 6, 12, 18; multiples of 9: 9, 18.', 'The smallest common one is 18.'],
    key: ['18', 'multiple'],
  },
];

const GREET = /ready to help|how can i help|hello|hi there|hi,|ask me|what can i do for you|i('m| am) here to help/i;

function judge(out, c) {
  const low = out.toLowerCase();
  const hasKey = c.key.some((k) => low.includes(k));
  const isGreet = GREET.test(out);
  return { hasKey, isGreet, ok: hasKey && !isGreet };
}

const gen = await pipeline('text-generation', 'onnx-community/SmolLM2-135M-Instruct-ONNX', { dtype: 'q8' });

async function run(system, user) {
  const out = await gen([
    { role: 'system', content: system },
    { role: 'user', content: user },
  ], { max_new_tokens: 80, do_sample: false });
  const msgs = out[0].generated_text;
  const last = msgs[msgs.length - 1];
  return (last && last.role === 'assistant' ? last.content : msgs.map((m) => m.content).join(' ')).trim();
}

// Variant A — EXACT current app behaviour: explanation only.
console.log('=== A: current app (SYSTEM_SIMPLE, explanation only) ===');
for (const c of CASES) {
  const expl = c.steps.filter((s) => !s.startsWith('Hint:')).join(' ');
  const out = await run(SYSTEM_SIMPLE, `Information: ${expl}`);
  const j = judge(out, c);
  console.log(`[${c.id}]\n  in : ${expl}\n  out: ${out}\n  key:${j.hasKey} greet:${j.isGreet} -> ${j.ok ? 'OK' : 'BAD'}`);
}

// Variant B — same prompt, but the FULL steps (hint + explanation).
console.log('\n=== B: SYSTEM_SIMPLE, full steps ===');
for (const c of CASES) {
  const out = await run(SYSTEM_SIMPLE, `Information: ${c.steps.join(' ')}`);
  const j = judge(out, c);
  console.log(`[${c.id}]\n  out: ${out}\n  key:${j.hasKey} greet:${j.isGreet} -> ${j.ok ? 'OK' : 'BAD'}`);
}

// Variant C — full steps + the question and answer as context.
console.log('\n=== C: SYSTEM_SIMPLE, question + answer + full steps ===');
for (const c of CASES) {
  const out = await run(SYSTEM_SIMPLE, `Information: Question: ${c.question} Answer: ${c.answer}. ${c.steps.join(' ')}`);
  const j = judge(out, c);
  console.log(`[${c.id}]\n  out: ${out}\n  key:${j.hasKey} greet:${j.isGreet} -> ${j.ok ? 'OK' : 'BAD'}`);
}

// Variant D — stronger rewrite prompt (no greeting, start with the text),
// full steps as input.
console.log('\n=== D: SYSTEM_REWRITE, full steps ===');
for (const c of CASES) {
  const out = await run(SYSTEM_REWRITE, `Text to rewrite: ${c.steps.join(' ')}`);
  const j = judge(out, c);
  console.log(`[${c.id}]\n  out: ${out}\n  key:${j.hasKey} greet:${j.isGreet} -> ${j.ok ? 'OK' : 'BAD'}`);
}
