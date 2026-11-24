// test_simpler.mjs — Node tests for the "Say it simpler" guard
// (practice.js simplerBoardSteps, v2.2 fix for Bug 1).
// Run from ~/workspace/primary-school-ai/work: node test_simpler.mjs
//
// The model outputs below are RECORDED from the real 135M int8 model in
// Node (work/repro_simpler.mjs, repro_simpler2.mjs) — same prompts the
// app sends, greedy decoding. The guard's job: a greeting, an echo, an
// invented fact/question, a repetition loop or a prompt parrot must
// never reach the board ([] = show the original steps instead); a
// genuine rewording that keeps only the steps' own content words must
// pass through, shorter and simpler than the original.
import { simplerBoardSteps } from '../practice.js';

let pass = 0, fail = 0;
function t(name, cond, extra = '') {
  if (cond) { pass++; console.log(`PASS ${name}`); }
  else { fail++; console.log(`FAIL ${name} ${extra}`); }
}
function eq(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

const SMART = ['Hint: The most: smarter or smartest?', 'smart - smarter - smartest.'];
const SNAIL = ['Hint: It carries its house on its back.', 'The animal in the diagram with a coiled shell is a snail, which is a mollusc.'];
const RAIN = ['Hint: Water rises as vapour, then forms clouds.', 'Water evaporates into vapour, then condenses into clouds that bring rain.'];
const LCM = ['Hint: List multiples of each until one matches.', 'Multiples of 6: 6, 12, 18; multiples of 9: 9, 18.', 'The smallest common one is 18.'];

// --- recorded failures: all must fall back ([]) ---
t('guard: greeting (reported case) falls back',
  eq(simplerBoardSteps("I'm ready to help you with your questions.", SMART), []));
t('guard: greeting + question falls back',
  eq(simplerBoardSteps("I'm ready to help you with your questions. What would you like to know or discuss?", LCM), []));
t('guard: meta comment about the task falls back',
  eq(simplerBoardSteps('The information given is in simple English sentences.', SNAIL), []));
t('guard: filler + verbatim echo falls back',
  eq(simplerBoardSteps("That's a great start! Now, let's continue with the information.\n\nWater evaporates into vapour, then condenses into clouds that bring rain.", RAIN), []));
t('guard: echo of the hint alone falls back',
  eq(simplerBoardSteps('The most: smarter or smartest?', SMART), []));
t('guard: system-prompt echo falls back',
  eq(simplerBoardSteps('You are a friendly teacher for primary school children in Uganda. Rewrite the text below in 1 or 2 short, simple English sentences a young child can understand. Do not greet the child. Do not ask a question. Use only the information given. Do not add facts.', RAIN), []));
t('guard: invented question falls back',
  eq(simplerBoardSteps('The most: smarter or smartest?\n\nQuestion: What is the most smartest person in the world?', SMART), []));
t('guard: repetition loop falls back',
  eq(simplerBoardSteps('Question: What is the most common answer?\n\nHint: Smart, smarter, smarter, smarter, smarter, smarter, smarter, smarter, smarter, smarter, smarter, smarter.', SMART), []));
t('guard: few-shot example parrot falls back',
  eq(simplerBoardSteps('Text: The sun rises in the east and sets in the west.\nSimple: The sun rises in the east. It goes down in the west.', LCM), []));
t('guard: invented fact ("lives in water") is dropped, good sentence kept',
  eq(simplerBoardSteps('The snail is a mollusc. It is a type of animal that lives in water.', SNAIL), ['The snail is a mollusc.']));
t('guard: invented characterization ("very small number") falls back',
  eq(simplerBoardSteps('18 is a very small number.', LCM), []));
t('guard: empty / blank output falls back',
  eq(simplerBoardSteps('', SMART), []) && eq(simplerBoardSteps('   ', SMART), []));
t('guard: steps with no content words (numbers only) fall back',
  eq(simplerBoardSteps('2 + 3 = 5.', ['2 + 3 = 5.']), []));

// --- recorded successes: genuine rewordings pass through ---
const snailSimple = simplerBoardSteps('The snail is a mollusc. It has a shell. The snail is a mollusc.', SNAIL);
t('guard: good rewording passes, duplicate sentence deduped',
  eq(snailSimple, ['The snail is a mollusc.', 'It has a shell.']), JSON.stringify(snailSimple));
t('guard: good rewording is shorter than the original steps',
  snailSimple.join(' ').length < SNAIL.join(' ').length, `${snailSimple.join(' ').length} vs ${SNAIL.join(' ').length}`);
t('guard: good rewording keeps the key content words',
  /snail/i.test(snailSimple.join(' ')) && /mollusc/i.test(snailSimple.join(' ')) && /shell/i.test(snailSimple.join(' ')));
t('guard: rewording with the question context passes',
  eq(simplerBoardSteps('The snail in the diagram is a mollusc.', SNAIL), ['The snail in the diagram is a mollusc.']));
t('guard: echo of the explanation passes only as the fallback ([])',
  eq(simplerBoardSteps('Multiples of 6: 6, 12, 18. The smallest common one is 18.', LCM), []));

// --- documented limitation: a rewording that introduces a new content
// word is dropped even when it is true ("made" is not in the steps).
// Safe direction: the board shows the original steps instead.
t('guard: new content word not in the steps falls back (documented)',
  eq(simplerBoardSteps('Clouds are made of water.', ['Water vapour condenses high in the sky to form clouds.']), []));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
