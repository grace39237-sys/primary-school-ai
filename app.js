// app.js — Ask Teacher UI + Ask (RAG) + Practice (teacher mode).
import * as ort from 'onnxruntime-web';
import { loadEmbedder, loadIndex, embedQuery, search } from './rag.js';
import { loadGenerator, askTeacher, saySimpler } from './ai.js';
import { loadASR, transcribe, hasLatin, ASR_MODEL_EN } from './asr.js';
import { loadWords, lookupWord } from './words.js';
import { makeBoard } from './board.js';
import { speak, ttsSupported } from './tts.js';
import { VoiceCapture } from './vad.js';
import { normAnswer, checkAnswer, stepsOf, nextLevel } from './practice.js';

// Same ONNX setup as the translator app: absolute wasmPaths (a relative
// path doubles to vendor/ort/vendor/ort/ and 404s), 1 thread — GitHub
// Pages has no COOP/COEP headers, so no SharedArrayBuffer.
ort.env.wasm.wasmPaths = new URL('./vendor/ort/', import.meta.url).href;
ort.env.wasm.numThreads = 1;

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});

const APP_VERSION = 'v2.1';
// Refusal threshold on the best retrieval cosine score. If the best chunk
// scores below this, the question is outside the books: refuse WITHOUT
// calling the model (the model test showed small models invent answers
// when they are asked to refuse themselves). Calibrated in Node against
// the built index — see work/calibrate_threshold.mjs.
const REFUSAL_THRESHOLD = 0.67;
// Teacher download size (button/info text, "about 215MB"). Verified sizes
// (Hugging Face API, 2026-11-24): MiniLM int8 21.9MB + SmolLM2-135M int8
// 129.4MB + Moonshine base-en int8 ~64MB (encoder 19.6 + decoder 40.5 +
// tokenizer 3.6; local Node cache measured 64MB).

const $ = (id) => document.getElementById(id);
const els = {
  statusDot: $('statusDot'), statusText: $('statusText'),
  modelBox: $('modelBox'), modelInfo: $('modelInfo'),
  downloadBtn: $('downloadBtn'), downloadProgress: $('downloadProgress'),
  downloadBar: $('downloadBar'), downloadLabel: $('downloadLabel'),
  homeWrap: $('homeWrap'), askModeBtn: $('askModeBtn'), practiceModeBtn: $('practiceModeBtn'),
  askWrap: $('askWrap'), askInput: $('askInput'), askBtn: $('askBtn'), askBackBtn: $('askBackBtn'),
  micBtn: $('micBtn'), listeningRow: $('listeningRow'),
  listeningStatus: $('listeningStatus'), sendBtn: $('sendBtn'),
  sensHighBtn: $('sensHighBtn'), sensMidBtn: $('sensMidBtn'), sensLowBtn: $('sensLowBtn'),
  askBoardWrap: $('askBoardWrap'),
  answerWrap: $('answerWrap'), answerText: $('answerText'),
  sourceWrap: $('sourceWrap'), sourceList: $('sourceList'),
  speakBtn: $('speakBtn'), copyBtn: $('copyBtn'), askHint: $('askHint'),
  practiceWrap: $('practiceWrap'), gradeSel: $('gradeSel'), subjectSel: $('subjectSel'),
  startBtn: $('startBtn'), practiceBackBtn: $('practiceBackBtn'),
  quizWrap: $('quizWrap'), quizMeta: $('quizMeta'), quizStars: $('quizStars'),
  quizPassage: $('quizPassage'), quizQuestion: $('quizQuestion'),
  quizAnswerArea: $('quizAnswerArea'), checkBtn: $('checkBtn'),
  quizResult: $('quizResult'), quizVerdict: $('quizVerdict'), quizCorrect: $('quizCorrect'),
  quizSteps: $('quizSteps'), simplerBtn: $('simplerBtn'), nextBtn: $('nextBtn'),
  simplerText: $('simplerText'), practiceBoardWrap: $('practiceBoardWrap'),
  modelLine: $('modelLine'),
};

let ready = false;
let modelsLoading = null;
const progressFiles = new Map();
let progressExpected = 0;

function setStatus(kind, text) {
  els.statusDot.className = `status-dot ${kind}`;
  els.statusText.textContent = text;
}

function fmtMB(n) {
  return n > 0 ? `${(n / 1048576).toFixed(0)}MB` : '';
}

function onProgress(info) {
  if (info.status === 'progress' && info.total) {
    progressFiles.set(info.file, { loaded: info.loaded, total: info.total });
  } else if (info.status === 'done' && info.file) {
    const prev = progressFiles.get(info.file);
    progressFiles.set(info.file, { loaded: prev?.total || 0, total: prev?.total || 0 });
  }
  let loadedBytes = 0;
  for (const f of progressFiles.values()) { loadedBytes += f.loaded; }
  if (progressExpected > 0) {
    const pct = Math.min(100, Math.round((loadedBytes / progressExpected) * 100));
    els.downloadBar.style.width = `${pct}%`;
    els.downloadLabel.textContent = `${fmtMB(loadedBytes)} / about ${fmtMB(progressExpected)} (${pct}%)`;
  }
}

function updateModelBox() {
  if (els.modelLine) els.modelLine.textContent = `AI: 135M · App ${APP_VERSION}`;
  if (ready) {
    els.modelBox.hidden = true;
    setStatus('ready', 'Teacher is ready');
  } else {
    els.modelBox.hidden = false;
    els.downloadBtn.disabled = false;
    els.downloadProgress.hidden = true;
    els.downloadLabel.hidden = true;
    setStatus('off', 'AI not ready');
  }
}

async function hasCachedModel(modelId) {
  try {
    const cache = await caches.open('transformers-cache');
    const keys = await cache.keys();
    return keys.some((r) => r.url.includes(modelId));
  } catch (_) {
    return false;
  }
}

// Loads MiniLM + 135M + the book index. Cached models load from the phone;
// only the first run downloads.
async function ensureModels() {
  if (ready) return;
  if (modelsLoading) return modelsLoading;
  modelsLoading = (async () => {
    progressFiles.clear();
    // The progress bar counts only the bytes this run actually downloads.
    // A returning v1.1 user already has MiniLM + 135M cached, so only the
    // ~64MB ASR model downloads — counting it against the full 215MB
    // would leave the bar stuck at ~30% when the teacher is ready.
    const cached = {
      mini: await hasCachedModel('Xenova/all-MiniLM-L6-v2'),
      gen: await hasCachedModel('onnx-community/SmolLM2-135M-Instruct-ONNX'),
      asr: await hasCachedModel(ASR_MODEL_EN),
    };
    const fromCache = cached.mini && cached.gen && cached.asr;
    progressExpected = (cached.mini ? 0 : 22 * 1048576)
      + (cached.gen ? 0 : 129 * 1048576)
      + (cached.asr ? 0 : 64 * 1048576);
    els.downloadBtn.disabled = true;
    if (fromCache) {
      els.downloadProgress.hidden = true;
      els.downloadLabel.hidden = true;
      setStatus('busy', 'Loading the saved teacher…');
    } else {
      els.downloadProgress.hidden = false;
      els.downloadLabel.hidden = false;
      els.downloadBar.style.width = '0%';
      els.downloadLabel.textContent = 'Getting…';
      setStatus('busy', 'Getting the teacher…');
    }
    try {
      await loadEmbedder(onProgress);
      await loadGenerator(onProgress);
      await loadASR(onProgress);
      setStatus('busy', 'Loading the books…');
      await loadIndex();
      ready = true;
      updateModelBox();
    } catch (e) {
      console.error(e);
      setStatus('off', 'Could not get the teacher — try again');
      els.downloadBtn.disabled = false;
      els.downloadLabel.hidden = false;
      els.downloadLabel.textContent = `Failed: ${e.message}`;
      modelsLoading = null;
      throw e;
    }
  })();
  return modelsLoading;
}

// ---- Chalkboards (Ask + Practice) ----
// Voice plays ONLY when the child taps a board's Listen button (v2.1).
// The old 'psa-listen' saved setting is deliberately never read, so a
// phone that saved 'on' in v2 does not auto-play again.
const askBoard = makeBoard(els.askBoardWrap);
const practiceBoard = makeBoard(els.practiceBoardWrap);

// ---- Mode switching ----
function showMode(mode) {
  els.homeWrap.hidden = mode !== 'home';
  els.askWrap.hidden = mode !== 'ask';
  els.practiceWrap.hidden = mode !== 'practice';
  if (mode !== 'ask') { stopMic(); askBoard.stop(); }
  if (mode !== 'practice') practiceBoard.stop();
  if (mode === 'home') window.scrollTo({ top: 0 });
}
els.askModeBtn.addEventListener('click', () => showMode('ask'));
els.practiceModeBtn.addEventListener('click', () => showMode('practice'));
els.askBackBtn.addEventListener('click', () => showMode('home'));
els.practiceBackBtn.addEventListener('click', () => showMode('home'));
els.downloadBtn.addEventListener('click', () => ensureModels().catch(() => {}));

// ---- Ask mode ----
function showAnswer(text, sources) {
  els.answerText.textContent = text;
  els.sourceList.innerHTML = '';
  if (sources && sources.length) {
    els.sourceWrap.hidden = false;
    for (const s of sources) {
      const li = document.createElement('li');
      li.textContent = s.chunk.source;
      const meta = document.createElement('div');
      meta.className = 'src-meta';
      meta.textContent = `${s.chunk.subject} · ${s.chunk.grade}${s.chunk.unit ? ` · ${s.chunk.unit}` : ''}`;
      li.appendChild(meta);
      els.sourceList.appendChild(li);
    }
  } else {
    els.sourceWrap.hidden = true;
  }
  els.answerWrap.hidden = false;
}

async function doAsk() {
  const q = els.askInput.value.trim();
  if (!q) return;
  stopMic();
  askBoard.clear();
  els.answerWrap.hidden = true;
  // Word lookup first: a single word (or two-word phrase) is answered
  // straight from the word list — no model, no download needed. A miss
  // falls through to the normal RAG flow below.
  try {
    const dict = await loadWords();
    const hit = lookupWord(q, dict);
    if (hit) {
      const steps = hit.def.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
      if (hit.ex) steps.push(`Example: ${hit.ex}`);
      showAnswer(hit.def, hit.ex ? [{ chunk: { source: `Example: ${hit.ex}`, subject: hit.subject, grade: hit.grade, unit: hit.unit || '' } }] : null);
      askBoard.show(steps);
      return;
    }
  } catch (_) {
    // Word list unavailable: fall through to RAG.
  }
  try {
    await ensureModels();
  } catch (_) {
    showAnswer('First get the teacher using the button at the top.', null);
    return;
  }
  setStatus('busy', 'Thinking…');
  try {
    const qvec = await embedQuery(q);
    const hits = search(qvec, 5);
    const best = hits[0];
    if (!best || best.score < REFUSAL_THRESHOLD) {
      // Outside the books: refuse WITHOUT calling the model.
      showAnswer("I don't know that yet — ask your teacher.", null);
      askBoard.show(["I don't know that yet — ask your teacher."]);
      setStatus('ready', 'Teacher is ready');
      return;
    }
    const top = hits.slice(0, 3);
    const context = top.map((h) => h.chunk.source).join(' ');
    const answer = await askTeacher(context, q);
    const shown = answer || top[0].chunk.source;
    showAnswer(shown, top);
    // Chalkboard steps: the answer's own sentences, then the book's
    // sentences it came from. Nothing invented.
    const steps = shown.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
    for (const s of top) steps.push(`From the book: ${s.chunk.source}`);
    askBoard.show(steps);
    setStatus('ready', 'Teacher is ready');
  } catch (e) {
    console.error(e);
    showAnswer(`Something went wrong: ${e.message}`, null);
    setStatus('ready', 'Teacher is ready');
  }
}
els.askBtn.addEventListener('click', doAsk);
els.askInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); doAsk(); }
});

// ---- Voice input (Ask only): mic → English ASR → editable question ----
// The transcript goes into the Ask box so the child can fix it first —
// place names like "Soroti" fail on both tiny and base models. Practice
// stays tap/type (no ASR for answers).
//
// Listening sensitivity: how easily the mic hears speech. High hears
// quiet speech (threshold = noise x3), Medium is normal (x6), Low
// ignores noise in loud places (x10). Default Medium, saved on the phone.
const SENSITIVITY = { high: 3, mid: 6, low: 10 };
let sensitivity = 'mid';
try { sensitivity = localStorage.getItem('psa-sensitivity') || 'mid'; } catch (_) {}
if (!SENSITIVITY[sensitivity]) sensitivity = 'mid';
function updateSensitivityUI() {
  els.sensHighBtn.setAttribute('aria-pressed', String(sensitivity === 'high'));
  els.sensMidBtn.setAttribute('aria-pressed', String(sensitivity === 'mid'));
  els.sensLowBtn.setAttribute('aria-pressed', String(sensitivity === 'low'));
}
function setSensitivity(next) {
  if (!SENSITIVITY[next]) return;
  sensitivity = next;
  try { localStorage.setItem('psa-sensitivity', next); } catch (_) {}
  updateSensitivityUI();
  // Applies at once, even while listening.
  if (capture) capture.sensitivity = SENSITIVITY[next];
}
els.sensHighBtn.addEventListener('click', () => setSensitivity('high'));
els.sensMidBtn.addEventListener('click', () => setSensitivity('mid'));
els.sensLowBtn.addEventListener('click', () => setSensitivity('low'));
updateSensitivityUI();

let capture = null;
let listening = false;

function setListeningUI(on, text) {
  listening = on;
  els.micBtn.classList.toggle('listening', on);
  els.micBtn.textContent = on ? '⏹ Stop' : '🎤 Speak';
  els.listeningRow.hidden = !on;
  if (text) els.listeningStatus.textContent = text;
}

function stopMic() {
  if (!capture && !listening) return;
  try { capture?.stop(); } catch (_) {}
  capture = null;
  setListeningUI(false);
}

async function startMic() {
  if (listening) { stopMic(); return; }
  try {
    await ensureModels();
  } catch (_) {
    showAnswer('First get the teacher using the button at the top.', null);
    return;
  }
  if (!('mediaDevices' in navigator) || !navigator.mediaDevices.getUserMedia) {
    alert('This phone cannot use the microphone. Type your question instead.');
    return;
  }
  try {
    capture = new VoiceCapture({
      sensitivity: SENSITIVITY[sensitivity],
      // Show at once when speech is heard, so the child can see it listened.
      onSpeechStart: () => setListeningUI(true, 'I hear you…'),
      onSpeechEnd: () => setListeningUI(true, 'Listening… tap Send to hear it now.'),
      onUtterance: async (audio) => {
        setListeningUI(true, 'Heard you — reading what you said…');
        try {
          const text = await transcribe(audio);
          if (!text || !hasLatin(text)) {
            els.listeningStatus.textContent = "I didn't hear English — try again.";
            return;
          }
          els.askInput.value = text;
          els.listeningStatus.textContent = 'Fix the words if they are wrong, then tap Ask the teacher.';
          stopMic();
          els.askInput.focus();
        } catch (e) {
          console.error(e);
          els.listeningStatus.textContent = 'Could not hear you — try again.';
        }
      },
    });
    await capture.start();
    setListeningUI(true, 'Listening… speak your question in English.');
  } catch (e) {
    console.error(e);
    alert('Microphone is not available. Please allow the microphone, or type your question.');
    capture = null;
    setListeningUI(false);
  }
}
els.micBtn.addEventListener('click', startMic);
els.sendBtn.addEventListener('click', () => {
  // Send now: transcribe the current utterance without waiting for silence.
  if (capture) {
    const had = capture.flush();
    if (!had) els.listeningStatus.textContent = 'Say something first, then tap Send.';
  }
});

// Phone's own voice for listening to the answer.
els.speakBtn.addEventListener('click', () => {
  if (!ttsSupported()) { alert('This phone cannot read aloud.'); return; }
  speak(els.answerText.textContent);
});
els.copyBtn.addEventListener('click', async () => {
  const text = els.answerText.textContent;
  const original = els.copyBtn.textContent;
  try { await navigator.clipboard.writeText(text); } catch (_) {
    const ta = document.createElement('textarea');
    ta.value = text; document.body.appendChild(ta); ta.select();
    document.execCommand('copy'); ta.remove();
  }
  els.copyBtn.textContent = 'Copied';
  setTimeout(() => { els.copyBtn.textContent = original; }, 1500);
});

// ---- Practice mode (teacher mode) ----
const PRACTICE_TYPES = ['multiple_choice', 'true_false', 'fill_blank', 'comprehension', 'multi_select'];
const DIFF_ORDER = ['easy', 'medium', 'hard'];
const SUBJECT_FILE = { English: 'english', Math: 'math', Science: 'science', Social: 'social' };

let bank = []; // current grade+subject items
let bankKey = '';
let current = null; // { item, userAnswer }
let recentIds = [];
let retryUnit = null; // after a wrong answer, stay on the same unit (concept)

function getLevels() {
  try { return JSON.parse(localStorage.getItem('psa-level') || '{}'); } catch (_) { return {}; }
}
function saveLevels(lv) {
  try { localStorage.setItem('psa-level', JSON.stringify(lv)); } catch (_) {}
}
function levelFor(subject) {
  const lv = getLevels();
  return lv[subject] || { difficulty: 'easy', streak: 0 };
}
function setLevel(subject, difficulty, streak) {
  const lv = getLevels();
  lv[subject] = { difficulty, streak };
  saveLevels(lv);
}

async function loadBank(grade, subject) {
  const key = `${grade}-${subject}`;
  if (bankKey === key) return;
  const n = grade.slice(1);
  const resp = await fetch(`./data/quiz/quiz_p${n}_${SUBJECT_FILE[subject]}.json`);
  if (!resp.ok) throw new Error(`Could not load ${subject} questions (${resp.status})`);
  bank = await resp.json();
  bankKey = key;
}

function pickQuestion(subject, opts = {}) {
  const lv = levelFor(subject);
  const wantDiff = opts.difficulty || lv.difficulty;
  let pool = bank.filter((it) => PRACTICE_TYPES.includes(it.type) && it.difficulty === wantDiff);
  if (opts.unit) {
    const sameUnit = pool.filter((it) => it.unit === opts.unit && !recentIds.includes(it.id));
    if (sameUnit.length) pool = sameUnit;
  }
  if (opts.notType) pool = pool.filter((it) => it.type !== opts.notType);
  pool = pool.filter((it) => !recentIds.includes(it.id));
  if (!pool.length) {
    // Fall back: any difficulty in this grade+subject, unseen first.
    pool = bank.filter((it) => PRACTICE_TYPES.includes(it.type) && !recentIds.includes(it.id));
  }
  if (!pool.length) {
    pool = bank.filter((it) => PRACTICE_TYPES.includes(it.type));
    recentIds = [];
  }
  const item = pool[Math.floor(Math.random() * pool.length)];
  recentIds.push(item.id);
  if (recentIds.length > 12) recentIds.shift();
  return item;
}


function renderQuestion(item) {
  current = { item, userAnswer: null };
  practiceBoard.clear();
  const lv = levelFor(els.subjectSel.value);
  els.quizMeta.textContent = `${els.gradeSel.value} · ${els.subjectSel.value} · ${item.difficulty} · Level: ${lv.difficulty}`;
  els.quizStars.textContent = '★'.repeat(Math.min(5, lv.streak)) + '☆'.repeat(Math.max(0, 5 - Math.min(5, lv.streak)));
  els.quizPassage.hidden = !item.passage;
  if (item.passage) els.quizPassage.textContent = item.passage;
  els.quizQuestion.textContent = item.question;
  els.quizResult.hidden = true;
  els.simplerText.hidden = true;
  els.simplerText.textContent = '';
  const area = els.quizAnswerArea;
  area.innerHTML = '';
  els.checkBtn.disabled = false;

  if (item.type === 'multiple_choice') {
    const list = document.createElement('div');
    list.className = 'opt-list';
    for (const opt of item.options || []) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'opt-btn'; b.textContent = opt;
      b.setAttribute('aria-pressed', 'false');
      b.addEventListener('click', () => {
        list.querySelectorAll('.opt-btn').forEach((x) => x.setAttribute('aria-pressed', 'false'));
        b.setAttribute('aria-pressed', 'true');
        current.userAnswer = opt;
      });
      list.appendChild(b);
    }
    area.appendChild(list);
  } else if (item.type === 'true_false') {
    const list = document.createElement('div');
    list.className = 'opt-list';
    for (const opt of ['True', 'False']) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'opt-btn'; b.textContent = opt;
      b.setAttribute('aria-pressed', 'false');
      b.addEventListener('click', () => {
        list.querySelectorAll('.opt-btn').forEach((x) => x.setAttribute('aria-pressed', 'false'));
        b.setAttribute('aria-pressed', 'true');
        current.userAnswer = opt;
      });
      list.appendChild(b);
    }
    area.appendChild(list);
  } else if (item.type === 'multi_select') {
    const list = document.createElement('div');
    list.className = 'opt-list';
    current.userAnswer = [];
    for (const opt of item.options || []) {
      const row = document.createElement('div');
      row.className = 'check-row';
      const cb = document.createElement('input');
      cb.type = 'checkbox'; cb.id = `ms-${opt}`.replace(/\W+/g, '-');
      cb.addEventListener('change', () => {
        current.userAnswer = [...list.querySelectorAll('input:checked')].map((x) => x.value);
      });
      cb.value = opt;
      const lab = document.createElement('label');
      lab.htmlFor = cb.id; lab.textContent = opt;
      row.appendChild(cb); row.appendChild(lab);
      list.appendChild(row);
    }
    area.appendChild(list);
    const hint = document.createElement('p');
    hint.className = 'hint';
    hint.textContent = 'Tick all the right answers.';
    area.appendChild(hint);
  } else {
    // fill_blank / comprehension: type the answer.
    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'Type your answer';
    input.setAttribute('aria-label', 'Type your answer');
    input.addEventListener('input', () => { current.userAnswer = input.value; });
    area.appendChild(input);
  }
}


function doCheck() {
  if (!current) return;
  const item = current.item;
  const ok = checkAnswer(item, current.userAnswer);
  els.checkBtn.disabled = true;
  // Mark the chosen options.
  els.quizAnswerArea.querySelectorAll('.opt-btn').forEach((b) => {
    b.disabled = true;
    if (normAnswer(b.textContent) === normAnswer(item.answer)) b.classList.add('correct');
    else if (b.getAttribute('aria-pressed') === 'true') b.classList.add('wrong');
  });
  els.quizAnswerArea.querySelectorAll('input').forEach((i) => { i.disabled = true; });
  els.quizVerdict.textContent = ok ? 'Correct! Well done!' : 'Not yet — look at the steps.';
  els.quizVerdict.className = `verdict ${ok ? 'good' : 'bad'}`;
  els.quizCorrect.textContent = ok ? '' : `The answer is: ${item.answer}`;
  const steps = stepsOf(item);
  els.quizSteps.innerHTML = '';
  for (const s of steps) {
    const li = document.createElement('li');
    li.textContent = s;
    els.quizSteps.appendChild(li);
  }
  els.quizResult.hidden = false;
  // Chalkboard: the same verified steps, one at a time.
  practiceBoard.show(steps);

  // Adaptive: right → streak up, two in a row moves one level up;
  // wrong → stay on the same concept (unit), same or one level down.
  const subject = els.subjectSel.value;
  const lv = levelFor(subject);
  const nl = nextLevel(lv, ok);
  setLevel(subject, nl.difficulty, nl.streak);
  if (ok) retryUnit = null; else retryUnit = item.unit || null;
}

async function nextQuestion() {
  const subject = els.subjectSel.value;
  const lv = levelFor(subject);
  let item;
  if (retryUnit) {
    // Same concept, a different type if possible, same or easier level.
    item = pickQuestion(subject, { unit: retryUnit, notType: current?.item.type });
    if (item.unit !== retryUnit) retryUnit = null;
  } else {
    item = pickQuestion(subject, { difficulty: lv.difficulty });
  }
  renderQuestion(item);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

els.startBtn.addEventListener('click', async () => {
  // Practice needs no AI model — only the question bank. ("Say it simpler"
  // loads the model on demand.) Do not gate practising behind the download.
  try {
    await loadBank(els.gradeSel.value, els.subjectSel.value);
  } catch (e) {
    alert(e.message);
    return;
  }
  recentIds = [];
  retryUnit = null;
  els.quizWrap.hidden = false;
  nextQuestion();
});
els.checkBtn.addEventListener('click', doCheck);
els.nextBtn.addEventListener('click', nextQuestion);
els.simplerBtn.addEventListener('click', async () => {
  if (!current) return;
  els.simplerBtn.disabled = true;
  els.simplerText.hidden = false;
  els.simplerText.textContent = 'Thinking…';
  try {
    await ensureModels();
    const text = await saySimpler(current.item.explanation || `The answer is ${current.item.answer}.`);
    els.simplerText.textContent = text;
  } catch (e) {
    els.simplerText.textContent = 'First get the teacher using the button at the top, then try again.';
  }
  els.simplerBtn.disabled = false;
});

// ---- startup: auto-load saved models ----
async function autoLoadSavedModels() {
  const em = await hasCachedModel('Xenova/all-MiniLM-L6-v2');
  const gm = await hasCachedModel('onnx-community/SmolLM2-135M-Instruct-ONNX');
  const am = await hasCachedModel(ASR_MODEL_EN);
  console.log('[auto-load]', em, gm, am);
  if (!em || !gm || !am) return; // button stays visible
  try { await ensureModels(); } catch (_) {}
}

showMode('home');
updateModelBox();
autoLoadSavedModels();
