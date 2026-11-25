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
// DL daily lesson plans (teacher material): Drive-latest copies, downloaded
// 2026-11-25 and byte-verified against the Drive DL folder
// (P*_DailyLesson.jsonl, plain names = upgrade1 content). The pilot1 files
// on Drive are an UNAPPROVED trial — never use them as the source.
// Local originals in dl-inspect/ (.fixed/.patched) are older/smaller.
const DL_DIR = '/home/hatch/workspace/dl-inspect';
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

// ---- DL daily-lesson parsing ----
// One JSONL line = one lesson-day (900 per grade, 6,300 total). The
// assistant message holds the plan in 3 markup variants (markdown PARTs,
// === sections, bare PART headers) — so fields are read from a window
// around the first 'Lesson_ID' occurrence with a tolerant field regex
// (bold markers may sit before OR after the colon: '**Lesson_ID:**' vs
// '**Lesson_ID**:'). The user message carries the requested slot as a
// fallback (P{grade}_Term {term}_{subject}_{WWDD}).
const DL_ALIASES = {
  'literacy 1': 'Literacy I', 'literacy i': 'Literacy I',
  'literacy 2': 'Literacy II', 'literacy ii': 'Literacy II',
  'news': 'News', 'english': 'English', 'mathematics': 'Mathematics',
  'integrated science': 'Integrated Science', 'science': 'Science',
  'social studies': 'Social Studies', 'social': 'Social',
  'christian religious education': 'Christian Religious Education',
  'religious education': 'Christian Religious Education',
};
function normDlSubject(s) {
  const t = String(s || '').trim().replace(/\s*\(.*?\)\s*$/, '').trim();
  return DL_ALIASES[t.toLowerCase()] || t;
}
function dlField(win, name) {
  // Bold markers may sit before the name, between name and colon
  // ('**Lesson_ID**:') AND after the colon ('**Lesson_ID:**') — all three
  // must be consumed, or the closing '**' leaks into the value (and
  // Number('** 01') is NaN, which broke 4,590 lines in the first run).
  const m = win.match(new RegExp(`\\*?\\*?${name}\\*?\\*?\\s*:\\s*\\*?\\*?\\s*(.+?)(?:\\n|$)`));
  return m ? m[1].trim() : '';
}
// Multi-line field (Questions): value plus following lines until the next
// field-like line or entry boundary, capped.
function dlFieldMulti(win, name, cap = 300) {
  const m = win.match(new RegExp(`\\*?\\*?${name}\\*?\\*?\\s*:\\s*\\*?\\*?\\s*([\\s\\S]*?)(?=\\n\\*?\\*?[A-Z][A-Za-z_]+\\*?\\*?\\s*:|\\n-{3,}|$)`));
  if (!m) return '';
  return m[1].replace(/\s+/g, ' ').trim().slice(0, cap);
}
function parseDlLine(line) {
  const d = JSON.parse(line);
  const user = (d.messages.find((m) => m.role === 'user') || {}).content || '';
  const asst = (d.messages.find((m) => m.role === 'assistant') || {}).content || '';
  const li = asst.indexOf('Lesson_ID');
  const win = li >= 0 ? asst.slice(Math.max(0, li - 200), li + 1600) : '';
  const um = user.match(/P(\d)_Term (\d+)_(.+)_(\d{2})(\d{2})/);
  const gt = dlField(win, 'Grade_Term');
  const termNum = (gt.match(/T(\d)/) || [])[1] || (um ? um[2] : '');
  // Week/Day are digit strings; Day may carry a parenthetical day name
  // ('3 (Wednesday)') — keep the name separately for the header.
  const weekRaw = dlField(win, 'Week_Number');
  const dayRaw = dlField(win, 'Day_Number');
  const weekDigits = (weekRaw.match(/\d+/) || [])[0] || (um ? um[4] : '');
  const dayDigits = (dayRaw.match(/\d+/) || [])[0] || (um ? um[5] : '');
  const week = weekDigits ? String(Number(weekDigits)) : '';
  const day = dayDigits ? String(Number(dayDigits)) : '';
  const dayName = (dayRaw.match(/\(([^)]+)\)/) || [])[1] || '';
  return {
    lessonId: dlField(win, 'Lesson_ID'),
    termNum, week, day, dayName,
    subject: normDlSubject(dlField(win, 'Subject')) || (um ? normDlSubject(um[3]) : ''),
    theme: dlField(win, 'Theme'),
    objective: dlField(win, 'Learning_Objective'),
    materials: dlField(win, 'Materials_Needed'),
    duration: dlField(win, 'Lesson_Duration'),
    languageFocus: dlField(win, 'Language_Focus'),
    asst, user,
  };
}
// The plan text kept in the index is a condensed, display-ready version:
// metadata + per-activity core content/task/questions + lesson summary.
// The full ~12KB plan text is NOT embedded: it would push index.json past
// GitHub's 100 MB per-file push limit (measured 78.2 MB of plan text) and
// no code path reads past the embedding/model truncation horizon anyway.
// The full plans stay authoritative in the Drive DL folder. PART 1 (week
// mapping) is dropped: its content IDs repeat in PART 2/3 and the chunk
// label already carries grade/term/week/theme.
function dlChunkText(p) {
  const head = `${p.grade} ${p.subject} Term ${p.termNum} Week ${p.week} Day ${p.day}${p.dayName ? ` (${p.dayName})` : ''}: ${p.theme}.`;
  const lines = [head];
  if (p.objective) lines.push(`Objective: ${p.objective}`);
  if (p.materials) lines.push(`Materials: ${p.materials}`);
  if (p.duration) lines.push(`Duration: ${p.duration}`);
  if (p.languageFocus) lines.push(`Language focus: ${p.languageFocus}`);
  // PART 3 database entries: one activity per entry.
  const acts = [];
  for (const seg of p.asst.split(/DATABASE ENTRY:/).slice(1)) {
    const core = dlField(seg, 'Core_Content');
    const task = dlField(seg, 'Activity_Task');
    const qs = dlFieldMulti(seg, 'Questions');
    if (core || task) acts.push(`- ${core}${task ? `: ${task}` : ''}${qs ? ` Questions: ${qs}` : ''}`);
  }
  if (acts.length) lines.push('Activities:', ...acts);
  const sm = p.asst.match(/(?:\*\*)?=== LESSON SUMMARY ===(?:\*\*)?\s*([\s\S]*?)\s*(?:\*\*)?=== END LESSON PLAN ===/);
  if (sm) lines.push(sm[1].replace(/\s+/g, ' ').trim());
  return lines.join('\n');
}
function dlSource(p) {
  const parts = [];
  if (p.objective) parts.push(`Objective: ${p.objective}`);
  if (p.materials) parts.push(`Materials: ${p.materials}`);
  if (p.duration) parts.push(`Duration: ${p.duration}`);
  const sm = p.asst.match(/(?:\*\*)?=== LESSON SUMMARY ===(?:\*\*)?\s*([\s\S]*?)\s*(?:\*\*)?=== END LESSON PLAN ===/);
  if (sm) parts.push(sm[1].replace(/\s+/g, ' ').trim());
  return parts.join(' ').replace(/\s+/g, ' ').trim().slice(0, 1500);
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
    // class_words.json entries use w / def / ex (not word / definition /
    // example). The old names made every word chunk "undefined: " (v2.1 fix).
    const word = w.w || w.word || w[0];
    const def = w.def || w.definition || w[1] || '';
    const ex = w.ex || w.example || w[2] || '';
    chunks.push({
      kind: 'word', id: `CW-${grade}-${word}`, subject: 'Vocabulary', grade: normGrade(grade),
      unit: '', type: 'definition', difficulty: 'easy',
      text: `${word}: ${def}${ex ? ` Example: ${ex}` : ''}`, source: def,
    });
    cwN++;
  }
}

let lessonN = 0, practiceN = 0, flowN = 0;
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
        // Full lesson sentences (v2.7): each flow option text is a story
        // sentence. Counted from disk: 7,018 (the feasibility doc's 8,768
        // is stale). The one-line 'lesson' summaries above are KEPT —
        // they carry goal/remember/keywords for topic-level queries, while
        // these sentences answer fact-level ones. Only 24 duplicate
        // sentences exist across lessons (0.3%); all are kept, each tied
        // to its own lesson via unit/id.
        for (let si = 0; si < (l.flow || []).length; si++) {
          const step = l.flow[si];
          for (let oi = 0; oi < (step.opts || []).length; oi++) {
            const t = ((step.opts[oi] || {}).t || '').trim();
            if (!t) continue;
            chunks.push({
              kind: 'lesson-text', id: `LT-${grade}-${subject}-${l.title}-${si}-${oi}`.slice(0, 80), subject, grade,
              unit: l.title, type: 'lesson', difficulty: 'easy',
              text: `${l.title}. ${t}`, source: t,
            });
            flowN++;
          }
        }
      }
    }
  }
}

// ---- 1b. DL daily lesson plans (teacher material, v2.7) ----
let dlN = 0, dlFail = 0;
for (let n = 1; n <= 7; n++) {
  const grade = `P${n}`;
  const file = path.join(DL_DIR, `${grade}_DailyLesson.drive.jsonl`);
  const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
  if (lines.length !== 900) throw new Error(`${grade} DL: expected 900 lines, got ${lines.length}`);
  for (const ln of lines) {
    const p = parseDlLine(ln);
    p.grade = grade;
    const week = Number(p.week), day = Number(p.day);
    if (!p.lessonId || !p.termNum || !week || !day || !p.subject || !p.theme) {
      dlFail++;
      console.error(`DL parse fail ${grade}: ${p.user}`);
      continue; // unlabelled line cannot be indexed; counted, not silent
    }
    const ww = String(week).padStart(2, '0'), dd = String(day).padStart(2, '0');
    const subjCompact = p.subject.replace(/\s+/g, '');
    chunks.push({
      kind: 'dl', id: `DL-${grade}-T${p.termNum}-${subjCompact}-W${ww}D${dd}`,
      subject: p.subject, grade, unit: `Term ${p.termNum} · Week ${week} Day ${day} · ${p.theme}`,
      type: 'lesson', difficulty: 'easy',
      text: dlChunkText(p), source: dlSource(p),
    });
    dlN++;
  }
}
if (dlFail) console.log(`DL parse failures (skipped, listed above): ${dlFail}`);

console.log(`chunks: quiz ${quizN} (no explanation: ${quizNoExpl}), class words ${cwN}, lessons ${lessonN}, lesson practice ${practiceN}, lesson sentences ${flowN}, DL plans ${dlN} (failed ${dlFail}), TOTAL ${chunks.length}`);

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
  lessonText: flowN, dl: dlN, dlFailed: dlFail,
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
