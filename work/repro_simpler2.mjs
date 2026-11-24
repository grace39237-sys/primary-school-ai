// repro_simpler2.mjs — second round: few-shot (E) and raw-completion (F)
// variants for "Say it simpler". Same 4 cases and judge as repro_simpler.mjs.
// Run from ~/workspace/primary-school-ai/work: node repro_simpler2.mjs
import { pipeline, env } from '@huggingface/transformers';

env.cacheDir = '/home/hatch/workspace/offline-translator/work/.cache';
env.allowLocalModels = false;

const SYSTEM_REWRITE = 'You are a friendly teacher for primary school children in Uganda. Rewrite the text below in 1 or 2 short, simple English sentences a young child can understand. Start with the rewritten text. Do not greet the child. Do not ask a question. Use ONLY the information given. Do not add facts.';

const SYSTEM_FEW = 'You are a friendly teacher for primary school children in Uganda. Rewrite the text in 1 or 2 short, simple English sentences a young child can understand. Start with the rewritten text. Do not greet the child. Do not ask a question. Use ONLY the information given.\n\nExample:\nText: A noun is a naming word. It names a person, place, animal or thing.\nSimple: A noun is a name. It names a person, a place, an animal or a thing.\n\nExample:\nText: The sun rises in the east and sets in the west.\nSimple: The sun comes up in the east. It goes down in the west.';

const CASES = [
  { id: 'P131140008 (REPORTED, P1 English)', steps: ['Hint: The most: smarter or smartest?', 'smart - smarter - smartest.'], key: ['smartest'] },
  { id: 'P614111031 (P6 Science, snail)', steps: ['Hint: It carries its house on its back.', 'The animal in the diagram with a coiled shell is a snail, which is a mollusc.'], key: ['snail', 'mollusc', 'shell'] },
  { id: 'P414010051 (P4 Science, rain)', steps: ['Hint: Water rises as vapour, then forms clouds.', 'Water evaporates into vapour, then condenses into clouds that bring rain.'], key: ['cloud', 'rain', 'vapour'] },
  { id: 'P412040016 (P4 Math, LCM)', steps: ['Hint: List multiples of each until one matches.', 'Multiples of 6: 6, 12, 18; multiples of 9: 9, 18.', 'The smallest common one is 18.'], key: ['18', 'multiple'] },
];

const GREET = /ready to help|how can i help|hello|hi there|hi,|ask me|what can i do for you|i('m| am) here to help/i;
function judge(out, c) {
  const low = out.toLowerCase();
  const hasKey = c.key.some((k) => low.includes(k));
  const isGreet = GREET.test(out);
  const echoesSystem = low.includes('rewrite the text below') || low.includes('friendly teacher');
  const asksQuestion = /\?\s*$/.test(out.trim()) && !c.steps.join(' ').includes('?') ? true : (out.includes('?') && !out.toLowerCase().includes(c.key[0]));
  return { hasKey, isGreet, echoesSystem, ok: hasKey && !isGreet && !echoesSystem };
}

const gen = await pipeline('text-generation', 'onnx-community/SmolLM2-135M-Instruct-ONNX', { dtype: 'q8' });

async function chat(system, user) {
  const out = await gen([
    { role: 'system', content: system },
    { role: 'user', content: user },
  ], { max_new_tokens: 80, do_sample: false });
  const msgs = out[0].generated_text;
  const last = msgs[msgs.length - 1];
  return (last && last.role === 'assistant' ? last.content : msgs.map((m) => m.content).join(' ')).trim();
}

async function raw(prompt) {
  const out = await gen(prompt, { max_new_tokens: 80, do_sample: false });
  return String(out[0].generated_text).slice(prompt.length).trim();
}

console.log('=== E: few-shot chat, full steps ===');
for (const c of CASES) {
  const out = await chat(SYSTEM_FEW, `Text: ${c.steps.join(' ')}`);
  const j = judge(out, c);
  console.log(`[${c.id}]\n  out: ${out}\n  key:${j.hasKey} greet:${j.isGreet} sysEcho:${j.echoesSystem} -> ${j.ok ? 'OK' : 'BAD'}`);
}

console.log('\n=== F: raw completion (no chat template) ===');
for (const c of CASES) {
  const prompt = `Say this in simple words for a young child:\n${c.steps.join(' ')}\nSimple words:`;
  const out = await raw(prompt);
  const j = judge(out, c);
  console.log(`[${c.id}]\n  out: ${out}\n  key:${j.hasKey} greet:${j.isGreet} sysEcho:${j.echoesSystem} -> ${j.ok ? 'OK' : 'BAD'}`);
}
