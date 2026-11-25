// build_oxford.mjs — builds data/oxford_words.json, the Oxford word
// list for Practice (v2.5). A compact copy of the vocabulary site's
// Oxford Plus data: 7,088 words, 20 levels, every entry with a
// definition + example. Only the fields Practice needs are kept
// ({w, def, ex, lv}) — no images, no audio — so the file stays small
// and loads in one fetch, then the service worker caches it like the
// quiz files.
//
// Source: ~/workspace/word-site/data/words.json (the deployed Oxford
// Plus list, lv 1–20). NOT ~/workspace/oxford-words/word-site-data/
// (an older 10-level build with no definitions).
//
// Usage: node build_oxford.mjs   (run from ~/workspace/primary-school-ai/work)
import fs from 'node:fs';

const SRC = '/home/hatch/workspace/word-site/data/words.json';
const OUT = '/home/hatch/workspace/primary-school-ai/data/oxford_words.json';

const src = JSON.parse(fs.readFileSync(SRC, 'utf8'));
const out = [];
const byLevel = {};
for (const e of src) {
  if (!e || !e.w || !e.def || !e.ex) continue;
  const lv = Number(e.lv);
  if (!lv || lv < 1 || lv > 20) continue;
  out.push({ w: e.w, def: e.def, ex: e.ex, lv });
  byLevel[lv] = (byLevel[lv] || 0) + 1;
}
fs.mkdirSync('/home/hatch/workspace/primary-school-ai/data', { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(out));
console.log(`oxford_words.json: ${out.length} entries, ${fs.statSync(OUT).size} bytes`);
console.log('by level:', JSON.stringify(byLevel));
if (out.length !== 7088) throw new Error(`expected 7088 entries, got ${out.length}`);
for (let lv = 1; lv <= 20; lv++) {
  const want = lv === 20 ? 362 : 354;
  if (byLevel[lv] !== want) throw new Error(`level ${lv}: expected ${want}, got ${byLevel[lv]}`);
}
console.log('counts verified: levels 1–19 = 354, level 20 = 362');
