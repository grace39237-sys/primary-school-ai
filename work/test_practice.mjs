// test_practice.mjs — Node verification of practice.js (same module app.js uses).
import { checkAnswer, stepsOf, nextLevel, normAnswer } from '../practice.js';
import fs from 'node:fs';

let pass = 0, fail = 0;
function t(name, cond) {
  if (cond) { pass++; console.log(`PASS ${name}`); }
  else { fail++; console.log(`FAIL ${name}`); }
}

// normAnswer
t('norm: case+space', normAnswer('  Eggs ') === 'eggs');
t('norm: trailing period', normAnswer('eggs.') === 'eggs');

// checkAnswer — multiple_choice / true_false (exact)
t('mc: exact', checkAnswer({ type: 'multiple_choice', answer: 'eggs' }, 'eggs'));
t('mc: case-insensitive', checkAnswer({ type: 'multiple_choice', answer: 'eggs' }, 'Eggs'));
t('mc: wrong', !checkAnswer({ type: 'multiple_choice', answer: 'eggs' }, 'milk'));
t('tf: True', checkAnswer({ type: 'true_false', answer: 'True' }, 'True'));
t('tf: wrong', !checkAnswer({ type: 'true_false', answer: 'True' }, 'False'));

// checkAnswer — fill_blank (contains rule)
t('fill: exact', checkAnswer({ type: 'fill_blank', answer: 'eggs' }, 'eggs'));
t('fill: longer containing', checkAnswer({ type: 'fill_blank', answer: 'eggs' }, 'Eggs are laid by hens'));
t('fill: wrong', !checkAnswer({ type: 'fill_blank', answer: 'eggs' }, 'milk'));
t('fill: empty', !checkAnswer({ type: 'fill_blank', answer: 'eggs' }, ''));

// checkAnswer — multi_select (set equality, order-free)
const ms = { type: 'multi_select', answer: ['Set M with 5 pencils', 'Set of 5 tins'] };
t('ms: exact set', checkAnswer(ms, ['Set of 5 tins', 'Set M with 5 pencils']));
t('ms: missing one', !checkAnswer(ms, ['Set M with 5 pencils']));
t('ms: extra one', !checkAnswer(ms, ['Set M with 5 pencils', 'Set of 5 tins', 'Set N with 3 chairs']));

// stepsOf — explanation split into steps, hint first
const item = { explanation: 'Domestic birds like hens give us eggs to eat. Hens lay eggs every day.', hint: 'Think of what a hen lays.' };
const steps = stepsOf(item);
t('steps: hint first', steps[0].startsWith('Hint:'));
t('steps: two sentences', steps.length === 3);
t('steps: no explanation fallback', stepsOf({ answer: 'eggs' })[0] === 'The answer is eggs.');

// nextLevel — adaptive transitions
t('level: 1st right keeps easy', JSON.stringify(nextLevel({ difficulty: 'easy', streak: 0 }, true)) === JSON.stringify({ difficulty: 'easy', streak: 1 }));
t('level: 2nd right moves up', JSON.stringify(nextLevel({ difficulty: 'easy', streak: 1 }, true)) === JSON.stringify({ difficulty: 'medium', streak: 0 }));
t('level: hard stays hard', JSON.stringify(nextLevel({ difficulty: 'hard', streak: 1 }, true)) === JSON.stringify({ difficulty: 'hard', streak: 2 }));
t('level: wrong resets streak', JSON.stringify(nextLevel({ difficulty: 'medium', streak: 1 }, false)) === JSON.stringify({ difficulty: 'medium', streak: 0 }));

// Real items from the bank: every PRACTICE type has at least one item per
// grade+subject, and answers are checkable.
const PRACTICE_TYPES = ['multiple_choice', 'true_false', 'fill_blank', 'comprehension', 'multi_select'];
const dataDir = '/home/hatch/workspace/word-words-repo/data';
let realChecked = 0;
for (const f of fs.readdirSync(dataDir).filter((x) => /^quiz_p[1-7]_(english|math|science|social)\.json$/.test(x))) {
  const items = JSON.parse(fs.readFileSync(`${dataDir}/${f}`, 'utf8'));
  for (const it of items) {
    if (!PRACTICE_TYPES.includes(it.type)) continue;
    // A correct answer must check as correct (self-consistency).
    const user = it.type === 'multi_select' ? it.answer : String(Array.isArray(it.answer) ? it.answer.join(', ') : it.answer);
    if (!checkAnswer(it, user)) { console.log(`FAIL self-check ${it.id} (${it.type})`); fail++; }
    realChecked++;
  }
}
console.log(`real bank items self-checked: ${realChecked}`);
t('real: all bank items self-check', realChecked === 36565); // 4 subjects x 5 practice types (excludes matching/sequencing/categorization + theme files). Recounted 2026-11-28: was 37480 at v2.7 — the audit fix list removed 918 items (915 in this pool, 3 in excluded types/files); no item fails its own self-check, only the count moved.

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
