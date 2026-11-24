// build_index.mjs — builds the prebuilt RAG index for the primary-school AI.
// Chunks: quiz items (question + answer + explanation), class words
// (word + definition + example), lesson summaries (title + goal + remember +
// keywords) and lesson practice Q&A pairs. P1–P7 only (scope).
// Embeddings: Xenova/all-MiniLM-L6-v2 int8, mean pooling, normalized.
// Vectors are int8-quantized per chunk (scale stored in index.json) and
// written as a raw binary file (data/index.bin); metadata + chunk text go
// in data/index.json. Quiz JSONs are copied to data/quiz/ for Practice mode.
//
// Usage: node build_index.mjs [--limit N] [--skip-embed]
//   --limit N     embed only the first N chunks (throughput check)
//   --skip-embed  build chunk list + copy quiz files, skip embedding
import { pipeline, env } from '@huggingface/transformers';
import fs from 'node:fs';
import path from 'node:path';

env.cacheDir = './.cache';
env.allowLocalModels = false;

const DATA = '/home/hatch/workspace/word-words-repo/data';
const BOOKS = '/home/hatch/workspace/word-words-repo/books';
const OUT = '/home/hatch/workspace/primary-school-ai/data';
const LIMIT = Number(process.argv.find((a) => a.startsWith('--limit='))?.split('=')[1] || 0);
const SKIP_EMBED = process.argv.includes('--skip-embed');

const normSubject = (s) => {
  const t = String(s || '').trim().toLowerCase();
  if (!t) return 'General';
  return t[0].toUpperCase() + t.slice(1);
};
const normGrade = (g) => String(g || '').trim().toUpperCase();

function answerText(a) {
  if (a == null) return '';
  if (typeof a === 'string') return a;
  if (Array.isArray(a)) return a.join(', ');
  if (typeof a === 'object') return Object.entries(a).map(([k, v]) => `${k}: ${v}`).join('; ');
  return String(a);
}

function parseBook(p) {
  const s = fs.readFileSync(p, 'utf8');
  const i = s.indexOf('var BOOK = ');
  if (i < 0) throw new Error(`no BOOK in ${p}`);
  let d = 0, inStr = false, esc = false;
  const start = i + 'var BOOK = '.length;
  for (let j = start; j < s.length; j++) {
    const c = s[j];
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') { inStr = true; continue; }
    if (c === '{') d++;
    else if (c === '}') { d--; if (d === 0) return JSON.parse(s.slice(start, j + 1)); }
  }
  throw new Error(`BOOK not closed in ${p}`);
}

// ---- 1. collect chunks ----
const chunks = [];
let quizN = 0, quizNoExpl = 0;
for (const f of fs.readdirSync(DATA).filter((x) => /^quiz_p[1-7]_/.test(x)).sort()) {
  const items = JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8'));
  for (const it of items) {
    const ans = answerText(it.answer);
    const expl = answerText(it.explanation).trim();
    if (!expl) quizNoExpl++;
    const text = `Q: ${it.question} A: ${ans}. ${expl}`.trim();
    chunks.push({
      kind: 'quiz', id: it.id, subject: normSubject(it.subject), grade: normGrade(it.grade),
      unit: it.unit || '', type: it.type, difficulty: it.difficulty || 'easy',
      text, source: expl || `Q: ${it.question} A: ${ans}`,
    });
    quizN++;
  }
}

const cw = JSON.parse(fs.readFileSync(path.join(DATA, 'class_words.json'), 'utf8'));
let cwN = 0;
for (const [grade, words] of Object.entries(cw)) {
  if (normGrade(grade) === 'KG') continue; // scope is P1–P7
  for (const w of words) {
    const word = w.word || w[0];
    const def = w.definition || w[1] || '';
    const ex = w.example || w[2] || '';
    chunks.push({
      kind: 'word', id: `CW-${grade}-${word}`, subject: 'Vocabulary', grade: normGrade(grade),
      unit: '', type: 'definition', difficulty: 'easy',
      text: `${word}: ${def}${ex ? ` Example: ${ex}` : ''}`, source: def,
    });
    cwN++;
  }
}

let lessonN = 0, practiceN = 0;
for (const f of fs.readdirSync(BOOKS).filter((x) => /^P[1-7]_.*\.html$/.test(x) && !x.includes('_teacher')).sort()) {
  const book = parseBook(path.join(BOOKS, f));
  const subject = normSubject(book.subject);
  const grade = normGrade(book.grade);
  for (const term of book.terms || []) {
    for (const theme of term.themes || []) {
      for (const l of theme.lessons || []) {
        const kwText = (l.keywords || []).map((k) => `${k[0]}: ${k[1]}`).join('; ');
        const summary = `${l.title}. ${l.goal || ''} ${l.remember || ''}${kwText ? ` Keywords: ${kwText}` : ''}`.trim();
        chunks.push({
          kind: 'lesson', id: `L-${grade}-${subject}-${l.title}`.slice(0, 80), subject, grade,
          unit: l.title, type: 'lesson', difficulty: 'easy',
          text: summary, source: l.remember || l.goal || summary,
        });
        lessonN++;
        for (const [q, a] of l.practice || []) {
          chunks.push({
            kind: 'lesson-qa', id: `LQ-${grade}-${subject}-${l.title}`.slice(0, 80), subject, grade,
            unit: l.title, type: 'lesson', difficulty: 'easy',
            text: `Q: ${q} A: ${a}`, source: a,
          });
          practiceN++;
        }
      }
    }
  }
}

console.log(`chunks: quiz ${quizN} (no explanation: ${quizNoExpl}), class words ${cwN}, lessons ${lessonN}, lesson practice ${practiceN}, TOTAL ${chunks.length}`);

// ---- 2. copy quiz JSONs for Practice mode ----
fs.mkdirSync(path.join(OUT, 'quiz'), { recursive: true });
for (const f of fs.readdirSync(DATA).filter((x) => /^quiz_p[1-7]_/.test(x))) {
  fs.copyFileSync(path.join(DATA, f), path.join(OUT, 'quiz', f));
}
console.log('quiz JSONs copied to data/quiz/');

const list = LIMIT > 0 ? chunks.slice(0, LIMIT) : chunks;
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'chunks.json'), JSON.stringify(list, null, 0));
console.log(`chunks.json written (${list.length} chunks)${LIMIT ? ' [LIMITED RUN]' : ''}`);
if (SKIP_EMBED) { console.log('skip-embed: done'); process.exit(0); }

// ---- 3. embed ----
const t0 = performance.now();
const extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', { dtype: 'q8' });
console.log(`MiniLM loaded in ${((performance.now() - t0) / 1000).toFixed(1)}s`);
const DIM = 384;
const scales = new Float32Array(list.length);
const bytes = Buffer.alloc(list.length * DIM);
const BATCH = 32;
for (let i = 0; i < list.length; i += BATCH) {
  const batch = list.slice(i, i + BATCH);
  const out = await extractor(batch.map((c) => c.text), { pooling: 'mean', normalize: true });
  // out: Tensor [batch, 384]
  const data = out.data; // Float32Array
  for (let b = 0; b < batch.length; b++) {
    const vec = data.subarray(b * DIM, (b + 1) * DIM);
    let mx = 0;
    for (let k = 0; k < DIM; k++) { const a = Math.abs(vec[k]); if (a > mx) mx = a; }
    const scale = mx / 127 || 1;
    scales[i + b] = scale;
    for (let k = 0; k < DIM; k++) {
      let q = Math.round(vec[k] / scale);
      if (q > 127) q = 127; else if (q < -127) q = -127;
      bytes.writeInt8(q, (i + b) * DIM + k);
    }
  }
  if ((i / BATCH) % 20 === 0 || i + BATCH >= list.length) {
    const done = Math.min(i + BATCH, list.length);
    const el = (performance.now() - t0) / 1000;
    console.log(`embedded ${done}/${list.length} (${(done / el).toFixed(1)}/s, ${el.toFixed(0)}s elapsed)`);
  }
}

// ---- 4. write index ----
const meta = list.map((c, i) => ({ ...c, scale: scales[i] }));
fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify({ version: 1, dim: DIM, count: list.length, chunks: meta }));
fs.writeFileSync(path.join(OUT, 'index.bin'), bytes);
const totalS = (performance.now() - t0) / 1000;
console.log(`DONE in ${totalS.toFixed(0)}s. index.json ${fs.statSync(path.join(OUT, 'index.json')).size} bytes, index.bin ${bytes.length} bytes.`);
const report = {
  builtAt: new Date().toISOString(), totalChunks: list.length,
  quiz: quizN, quizNoExplanation: quizNoExpl, classWords: cwN, lessons: lessonN, lessonPractice: practiceN,
  limitedRun: LIMIT > 0, seconds: +totalS.toFixed(1),
  byKind: {}, bySubject: {}, byGrade: {},
};
for (const c of list) {
  report.byKind[c.kind] = (report.byKind[c.kind] || 0) + 1;
  report.bySubject[c.subject] = (report.bySubject[c.subject] || 0) + 1;
  report.byGrade[c.grade] = (report.byGrade[c.grade] || 0) + 1;
}
fs.writeFileSync('./index_report.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
