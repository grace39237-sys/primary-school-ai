// app.js — Ask Teacher UI + Ask (RAG) + Practice (teacher mode).
import * as ort from 'onnxruntime-web';
import { loadEmbedder, loadIndex, embedQuery, search, searchInGrade } from './rag.js';
import { loadGenerator, askTeacher, saySimpler } from './ai.js';
import { loadASR, transcribe, hasLatin, ASR_MODEL_EN } from './asr.js';
import { loadWords, lookupWord, relatedWords } from './words.js';
import { classifyBand, distinctChoices, relatedHits, gradeHitsUsable } from './choices.js';
import { stripMarkdown } from './textutil.js';
import { makeBoard } from './board.js';
import { speak, ttsSupported } from './tts.js';
import { VoiceCapture, legacySensitivityToNoiseLevel } from './vad.js';
import { loadOxfordWords } from './oxford.js';
import { buildWordBank, wordsByLevel, wordsByGradeVocabulary } from './wordquiz.js';
import {
  emptyRecord, loadRecord, recordPracticeAnswer, recordAskQuestion,
  summarize, todayStr, markCorrect, isRecentlyCorrect, pruneRecentCorrect,
  RECORDS_KEY, RECENT_CORRECT_KEY,
} from './records.js';
import { normAnswer, checkAnswer, stepsOf, nextLevel, simplerBoardSteps, filterByTerm } from './practice.js';
import { migrateAskGrade, isValidAskGrade, nextPracticePickers } from './pickers.js';

// Same ONNX setup as the translator app: absolute wasmPaths (a relative
// path doubles to vendor/ort/vendor/ort/ and 404s), 1 thread — GitHub
// Pages has no COOP/COEP headers, so no SharedArrayBuffer.
ort.env.wasm.wasmPaths = new URL('./vendor/ort/', import.meta.url).href;
ort.env.wasm.numThreads = 1;

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});

const APP_VERSION = 'v2.8';
// Two bands on the best retrieval cosine score (v2.2 — Won, 2026-11-24).
// >= 0.67: clear — answer directly. 0.40–0.67: unclear — show 3 choices
// from the retrieved chunks and let the student pick one. Below 0.40:
// outside the books — refuse WITHOUT calling the model (the model test
// showed small models invent answers when they are asked to refuse
// themselves). The 3-choice step is the safeguard for the lowered
// threshold: an off-topic question that lands above 0.40 still has to
// survive the child's own pick. Calibrated in Node against the built
// index — see work/calibrate_threshold.mjs and work/band_check_v2_2.mjs.
// Teacher download size (button/info text, "about 215MB"). Verified sizes
// (Hugging Face API, 2026-11-24): MiniLM int8 21.9MB + SmolLM2-135M int8
// 129.4MB + Moonshine base-en int8 ~64MB (encoder 19.6 + decoder 40.5 +
// tokenizer 3.6; local Node cache measured 64MB).

const $ = (id) => document.getElementById(id);
const els = {
  statusDot: $('statusDot'), statusText: $('statusText'),
  topAskBtn: $('topAskBtn'), topPracticeBtn: $('topPracticeBtn'),
  modelBox: $('modelBox'), modelInfo: $('modelInfo'),
  downloadBtn: $('downloadBtn'), downloadProgress: $('downloadProgress'),
  downloadBar: $('downloadBar'), downloadLabel: $('downloadLabel'),
  homeWrap: $('homeWrap'), askModeBtn: $('askModeBtn'), practiceModeBtn: $('practiceModeBtn'),
  myLearning: $('myLearning'), learnSubjects: $('learnSubjects'),
  learnQuestions: $('learnQuestions'), learnEmpty: $('learnEmpty'),
  askWrap: $('askWrap'), askInput: $('askInput'), askBtn: $('askBtn'), askBackBtn: $('askBackBtn'),
  askGradeSel: $('askGradeSel'),
  micBtn: $('micBtn'), listeningRow: $('listeningRow'),
  listeningStatus: $('listeningStatus'), sendBtn: $('sendBtn'),
  sensHighBtn: $('sensHighBtn'), sensMidBtn: $('sensMidBtn'), sensLowBtn: $('sensLowBtn'),
  noiseRow: $('noiseRow'),
  askBoardWrap: $('askBoardWrap'),
  answerWrap: $('answerWrap'), answerText: $('answerText'),
  sourceWrap: $('sourceWrap'), sourceList: $('sourceList'),
  speakBtn: $('speakBtn'), copyBtn: $('copyBtn'), moreBtn: $('moreBtn'), askHint: $('askHint'),
  choiceWrap: $('choiceWrap'), choiceList: $('choiceList'), choiceNoneBtn: $('choiceNoneBtn'),
  practiceWrap: $('practiceWrap'), gradeSel: $('gradeSel'), subjectSel: $('subjectSel'),
  termSel: $('termSel'), termSelWrap: $('termSelWrap'),
  oxfordLevelSel: $('oxfordLevelSel'), oxfordLevelSelWrap: $('oxfordLevelSelWrap'),
  startBtn: $('startBtn'), practiceBackBtn: $('practiceBackBtn'),
  quizWrap: $('quizWrap'), quizMeta: $('quizMeta'), quizStars: $('quizStars'),
  quizPassage: $('quizPassage'), quizQuestion: $('quizQuestion'),
  quizAnswerArea: $('quizAnswerArea'), checkBtn: $('checkBtn'),
  quizResult: $('quizResult'), quizVerdict: $('quizVerdict'), quizCorrect: $('quizCorrect'),
  simplerBtn: $('simplerBtn'), nextBtn: $('nextBtn'), nextBtn2: $('nextBtn2'),
  practiceBoardWrap: $('practiceBoardWrap'),
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
  // Header switcher (v2.4): the button for the current mode is marked;
  // on home neither is marked.
  els.topAskBtn.setAttribute('aria-pressed', String(mode === 'ask'));
  els.topPracticeBtn.setAttribute('aria-pressed', String(mode === 'practice'));
  if (mode !== 'ask') { stopMic(); askBoard.stop(); hideChoices(); }
  if (mode !== 'practice') practiceBoard.stop();
  if (mode === 'home') { renderMyLearning(); window.scrollTo({ top: 0 }); }
}
els.askModeBtn.addEventListener('click', () => showMode('ask'));
els.practiceModeBtn.addEventListener('click', () => showMode('practice'));
els.topAskBtn.addEventListener('click', () => showMode('ask'));
els.topPracticeBtn.addEventListener('click', () => showMode('practice'));
els.askBackBtn.addEventListener('click', () => showMode('home'));
els.practiceBackBtn.addEventListener('click', () => showMode('home'));
els.downloadBtn.addEventListener('click', () => ensureModels().catch(() => {}));

// ---- Ask mode ----
// Display side strips markdown markers (v2.4): the answer and the source
// sentences come from chunks that write "**___**" / "**cold**", and the
// model echoes context, so '**' can appear in generated answers too.
// The data and the index are untouched.
function showAnswer(text, sources) {
  els.answerText.textContent = stripMarkdown(text);
  els.sourceList.innerHTML = '';
  if (sources && sources.length) {
    els.sourceWrap.hidden = false;
    for (const s of sources) {
      const li = document.createElement('li');
      li.textContent = stripMarkdown(s.chunk.source);
      const meta = document.createElement('div');
      meta.className = 'src-meta';
      meta.textContent = `${s.chunk.subject} · ${s.chunk.grade}${s.chunk.unit ? ` · ${s.chunk.unit}` : ''}`;
      li.appendChild(meta);
      els.sourceList.appendChild(li);
    }
  } else {
    els.sourceWrap.hidden = true;
  }
  // 'More' is hidden by default: only a successful answer re-shows it
  // (updateMoreButton, below). Refusals, word answers without related
  // words, and errors never show it.
  els.moreBtn.hidden = true;
  els.answerWrap.hidden = false;
}

// ---- "Which one did you mean?" — 3 choices for an unclear question ----
let pendingChoices = null; // { question, choices } while the choices are shown

function hideChoices() {
  pendingChoices = null;
  if (els.choiceWrap) els.choiceWrap.hidden = true;
  if (els.choiceList) els.choiceList.innerHTML = '';
}

// Answer from retrieved chunks: the model rephrases the context into 1–2
// short simple sentences; the source sentence(s) are always shown next
// to the answer, and the board shows the answer's sentences plus the
// book's sentences it came from. Nothing invented.
async function answerWithContext(q, context, displaySources) {
  const answer = await askTeacher(context, q);
  const shown = answer || displaySources[0].chunk.source;
  showAnswer(shown, displaySources);
  const steps = shown.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
  for (const s of displaySources) steps.push(`From the book: ${s.chunk.source}`);
  askBoard.show(steps);
  // A successful answer may have related items to explore (v2.4 'More').
  await updateMoreButton();
}

function refuseAnswer() {
  showAnswer("I don't know that yet — ask your teacher.", null);
  askBoard.show(["I don't know that yet — ask your teacher."]);
}

function showChoices(q, hits) {
  const choices = distinctChoices(hits, 3);
  if (!choices.length) { refuseAnswer(); return; }
  // State for 'More': the top hits of this Ask (the child may explore
  // the ones they did not pick, after answering one).
  lastQuestion = q;
  lastAskHits = hits;
  showChoiceObjects(q, choices);
}

// The buttons for a set of already-built choices (from distinctChoices,
// or related words for 'More'). Labels are stripped of markdown markers
// (v2.4) before they are shown.
function showChoiceObjects(q, choices) {
  pendingChoices = { question: q, choices };
  els.choiceList.innerHTML = '';
  for (const c of choices) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'opt-btn'; b.textContent = stripMarkdown(c.label);
    b.setAttribute('aria-pressed', 'false');
    b.addEventListener('click', () => chooseOne(c, b));
    els.choiceList.appendChild(b);
  }
  // 'More' hides while choices are on screen; it comes back (if the
  // answer has related items) once the child picks one — or taps
  // 'None of these' while an answer is still displayed.
  els.moreBtn.hidden = true;
  els.choiceWrap.hidden = false;
}

async function chooseOne(c, btn) {
  if (!pendingChoices) return;
  const q = pendingChoices.question;
  pendingChoices = null; // one pick only — a second tap cannot re-fire
  // Feedback at once (v2.4 — Won, 2026-11-25): the tapped choice stays
  // marked (the green filled style), the others go quiet, and the answer
  // area says 'Thinking…' while the model works — seconds on a phone.
  // Before this, the choices vanished instantly and only a small status
  // line at the top changed, so the tap looked dead.
  if (els.choiceList) {
    els.choiceList.querySelectorAll('.opt-btn').forEach((b) => {
      b.disabled = true;
      b.setAttribute('aria-pressed', b === btn ? 'true' : 'false');
    });
  }
  setStatus('busy', 'Thinking…');
  els.answerText.textContent = 'Thinking…';
  els.sourceWrap.hidden = true;
  els.answerWrap.hidden = false;
  try {
    if (c.word) {
      // A related word from 'More': answer through the normal word
      // lookup path (definition + example, no model call). The tapped
      // word is recorded like an asked question.
      saveRecord((rec) => recordAskQuestion(rec, c.word.w || c.word.word || '', todayStr()));
      lastAnsweredChunk = null;
      await showWordAnswer(c.word);
    } else {
      await ensureModels();
      // Answer from the chunk the child picked — its own full text (the
      // curriculum question + answer), so a thin source line cannot starve
      // the model. Only that chunk is shown as the source.
      lastAnsweredChunk = c.chunk;
      await answerWithContext(q, c.chunk.text || c.chunk.source, [c]);
    }
    setStatus('ready', 'Teacher is ready');
  } catch (e) {
    console.error(e);
    showAnswer(`Something went wrong: ${e.message}`, null);
    setStatus('ready', 'Teacher is ready');
  } finally {
    // The choices stay visible (with the pick marked) until the answer
    // arrives — only then do they go away.
    hideChoices();
  }
}
els.choiceNoneBtn.addEventListener('click', () => {
  // None of these: clear the choices and leave the input for a
  // rephrased question. The input stays visible and editable.
  hideChoices();
  els.askInput.focus();
  // If an answer is still displayed (the 'More' flow), its 'More'
  // button comes back — the related items are still there to explore.
  updateMoreButton();
});

// ---- 'More' on the Ask answer card (v2.4) ----
// Shown after ANY successful answer, never hidden for lack of related
// topics (Won, 2026-11-25). The only exception is a refusal — there is
// no answer to relate to. RAG answers relate to the other top hits from
// the same Ask; word answers relate to other words in the same grade +
// subject (same unit first). A RAG answer with no other hits falls back
// to words in the answered chunk's grade + subject.
let lastQuestion = null; // the question behind the displayed answer
let lastAskHits = null; // top hits of that Ask (RAG answers)
let lastAnsweredChunk = null; // the chunk the answer came from
let lastWordEntry = null; // the word entry (word answers)

async function relatedChoices() {
  if (lastAskHits) {
    const rel = relatedHits(lastAskHits, lastAnsweredChunk);
    if (rel.length) return distinctChoices(rel, 3);
  }
  const entry = lastWordEntry || (lastAnsweredChunk && lastAnsweredChunk.grade
    ? { w: '', grade: lastAnsweredChunk.grade, subject: lastAnsweredChunk.subject, unit: lastAnsweredChunk.unit || '' }
    : null);
  if (!entry) return [];
  try {
    const dict = await loadWords();
    return relatedWords(dict, entry, 3).map((e) => ({ word: e, label: e.w || e.word || '' }));
  } catch (_) {
    return [];
  }
}

async function updateMoreButton() {
  const rel = await relatedChoices();
  els.moreBtn.hidden = !rel.length;
}

els.moreBtn.addEventListener('click', async () => {
  const rel = await relatedChoices();
  if (!rel.length) { els.moreBtn.hidden = true; return; }
  if (!lastQuestion) return;
  showChoiceObjects(lastQuestion, rel);
});

// A single word, answered straight from the word list — no model, no
// retrieval (v2.1). Definition + example on the card and the board.
// Shared by doAsk and by 'More' (tapping a related word).
async function showWordAnswer(hit) {
  const steps = hit.def.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
  if (hit.ex) steps.push(`Example: ${hit.ex}`);
  showAnswer(hit.def, hit.ex ? [{ chunk: { source: `Example: ${hit.ex}`, subject: hit.subject, grade: hit.grade, unit: hit.unit || '' } }] : null);
  askBoard.show(steps);
  lastWordEntry = hit;
  lastAskHits = null;
  lastAnsweredChunk = null;
  await updateMoreButton();
}

async function doAsk() {
  const q = els.askInput.value.trim();
  if (!q) return;
  // Every asked question goes into the phone-only record (v2.5), so the
  // child can tap it on Home and ask it again.
  saveRecord((rec) => recordAskQuestion(rec, q, todayStr()));
  stopMic();
  hideChoices();
  askBoard.clear();
  els.answerWrap.hidden = true;
  // Word lookup first: a single word (or two-word phrase) is answered
  // straight from the word list — no model, no download needed. A miss
  // falls through to the normal RAG flow below.
  try {
    const dict = await loadWords();
    const hit = lookupWord(q, dict);
    if (hit) {
      lastQuestion = q;
      await showWordAnswer(hit);
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
    // Grade first (v2.4): the child's own grade's chunks are searched
    // first; when nothing there scores >= 0.40, fall back to all grades,
    // so a question about a topic taught in another grade still gets an
    // answer instead of a refusal. The band logic below runs on whichever
    // hits come back, and the source line shows the chunk's grade.
    let hits;
    if (askGrade === 'all') {
      hits = search(qvec, 5);
    } else {
      hits = searchInGrade(qvec, askGrade, 5);
      if (!gradeHitsUsable(hits)) hits = search(qvec, 5);
    }
    const best = hits[0];
    const band = classifyBand(best ? best.score : NaN);
    if (band === 'refuse') {
      // Outside the books: refuse WITHOUT calling the model.
      refuseAnswer();
      setStatus('ready', 'Teacher is ready');
      return;
    }
    if (band === 'choices') {
      // Unclear question: show 3 choices from the retrieved chunks and
      // let the student pick one — do not answer directly, do not refuse.
      showChoices(q, hits);
      setStatus('ready', 'Teacher is ready');
      return;
    }
    const top = hits.slice(0, 3);
    const context = top.map((h) => h.chunk.source).join(' ');
    // State for 'More': the other top hits of this Ask. All 5 hits are
    // kept — relatedHits caps the related list at 3.
    lastQuestion = q;
    lastAskHits = hits;
    lastAnsweredChunk = top[0] ? top[0].chunk : null;
    lastWordEntry = null;
    await answerWithContext(q, context, top);
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
// Noise level (v2.3, from the translator app v15): the selector is by how
// NOISY the place is, not by sensitivity. Low noise = most sensitive
// (threshold = baseline x3, low-cut 80Hz, speech band +6dB); Medium = x6
// (120Hz, +3dB); High noise = least sensitive (x10, 200Hz, +0dB) — in a
// noisy place the speech-band boost stays off, or the noise gets boosted
// too. Default Medium, saved on the phone.
// Migration: v2.1 stored sensitivity labels, where 'high' meant most
// sensitive. legacySensitivityToNoiseLevel flips them so the BEHAVIOUR is
// unchanged (old 'high' -> new 'low' noise, old 'low' -> new 'high'
// noise). Once migrated, 'psa-sensitivity-noise' = '1' marks the stored
// value as a noise level, so it is read as-is.
const SENSITIVITY = { low: 3, mid: 6, high: 10 };
let sensitivity = 'mid';
try {
  const raw = localStorage.getItem('psa-sensitivity');
  const migrated = localStorage.getItem('psa-sensitivity-noise') === '1';
  sensitivity = migrated
    ? (SENSITIVITY[raw] ? raw : 'mid')
    : legacySensitivityToNoiseLevel(raw);
  localStorage.setItem('psa-sensitivity', sensitivity);
  localStorage.setItem('psa-sensitivity-noise', '1');
} catch (_) {}
function updateSensitivityUI() {
  els.sensHighBtn.setAttribute('aria-pressed', String(sensitivity === 'high'));
  els.sensMidBtn.setAttribute('aria-pressed', String(sensitivity === 'mid'));
  els.sensLowBtn.setAttribute('aria-pressed', String(sensitivity === 'low'));
}
function setSensitivity(next) {
  if (!SENSITIVITY[next]) return;
  sensitivity = next;
  try {
    localStorage.setItem('psa-sensitivity', next);
    localStorage.setItem('psa-sensitivity-noise', '1');
  } catch (_) {}
  updateSensitivityUI();
  // Applies at once, even while listening: threshold AND EQ strength
  // change together (v2.3 — the old code only set capture.sensitivity,
  // which would have left the EQ on the previous setting).
  if (capture) capture.setSensitivity(SENSITIVITY[next]);
}
els.sensHighBtn.addEventListener('click', () => setSensitivity('high'));
els.sensMidBtn.addEventListener('click', () => setSensitivity('mid'));
els.sensLowBtn.addEventListener('click', () => setSensitivity('low'));
updateSensitivityUI();

// Ask grade filter (v2.4 — Won, 2026-11-25): search the child's own grade
// first, so the answer usually comes from their own books. Saved on the
// phone, like the noise setting. The single-word lookup stays
// grade-agnostic (each word has exactly one grade entry, so filtering
// would refuse words taught in other grades).
// v2.6.1: KG is gone — Won cancelled kindergarten, so the selector offers
// All grades + P1–P7 only. A phone that saved 'KG' under v2.4 falls back
// to 'all' on load (migrateAskGrade, pickers.js) and the stored value is
// rewritten, the same one-time migration pattern as the v2.3 sensitivity
// migration — the old value never comes back.
let askGrade = 'all';
try {
  const g = localStorage.getItem('psa-ask-grade');
  askGrade = migrateAskGrade(g);
  if (g === 'KG') localStorage.setItem('psa-ask-grade', 'all');
} catch (_) {}
function setAskGrade(next) {
  if (!isValidAskGrade(next)) return;
  askGrade = next;
  try { localStorage.setItem('psa-ask-grade', next); } catch (_) {}
  if (els.askGradeSel) els.askGradeSel.value = next;
}
els.askGradeSel.addEventListener('change', () => setAskGrade(els.askGradeSel.value));
if (els.askGradeSel) els.askGradeSel.value = askGrade;

let capture = null;
let listening = false;

function setListeningUI(on, text) {
  listening = on;
  els.micBtn.classList.toggle('listening', on);
  els.micBtn.textContent = on ? '⏹ Stop' : '🎤 Voice';
  els.listeningRow.hidden = !on;
  // Noise (v2.6): shown only while Voice input is active — the setting
  // only matters while speaking. Hidden again when voice input ends
  // (stopMic, leaving Ask, or a failed mic start all call this with
  // false). The saved value and the v2.3 behaviour are untouched.
  els.noiseRow.hidden = !on;
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

// ---- Learning records, phone only (v2.5 — Won, 2026-11-25) ----
// Per-subject average score + recent Ask questions, in localStorage
// under 'psa-records'. No account, no server, no name picker — one
// record per phone. Changing phones or clearing browser data erases
// the record. The current level is NOT duplicated here: it already
// lives in 'psa-level' and summarize() reads it from there.
function saveRecord(mutator) {
  try {
    const rec = loadRecord(localStorage.getItem(RECORDS_KEY));
    mutator(rec);
    localStorage.setItem(RECORDS_KEY, JSON.stringify(rec));
  } catch (_) {}
}

// Items answered correctly in the last 7 days (records.js): Practice
// skips them so progress continues instead of looping the same
// questions. Stored under 'psa-recent-correct' as { itemId: date }.
let recentCorrect = {};
function loadRecentCorrectMap() {
  try {
    const raw = localStorage.getItem(RECENT_CORRECT_KEY);
    recentCorrect = pruneRecentCorrect(raw ? JSON.parse(raw) : {}, todayStr());
  } catch (_) {
    recentCorrect = {};
  }
  return recentCorrect;
}
function saveRecentCorrectMap() {
  try { localStorage.setItem(RECENT_CORRECT_KEY, JSON.stringify(recentCorrect)); } catch (_) {}
}
loadRecentCorrectMap();

// 'My learning' on Home: one row per practiced subject (average %,
// current level, last practiced date) + recent questions to ask again.
// Rendered every time Home shows, so it is always up to date.
function renderMyLearning() {
  if (!els.learnSubjects || !els.learnQuestions) return;
  let rec = emptyRecord();
  try { rec = loadRecord(localStorage.getItem(RECORDS_KEY)); } catch (_) {}
  const rows = summarize(rec, getLevels());
  els.learnSubjects.innerHTML = '';
  for (const r of rows) {
    const div = document.createElement('div');
    div.className = 'learn-row';
    const name = document.createElement('span');
    name.className = 'learn-subject';
    name.textContent = r.label;
    const score = document.createElement('span');
    score.className = 'learn-score';
    score.textContent = `${r.pct}% · ${r.correct}/${r.total}`;
    const meta = document.createElement('span');
    meta.className = 'learn-meta';
    meta.textContent = `Level: ${r.level}${r.last ? ` · ${r.last}` : ''}`;
    div.appendChild(name); div.appendChild(score); div.appendChild(meta);
    els.learnSubjects.appendChild(div);
  }
  els.learnQuestions.innerHTML = '';
  for (const entry of rec.questions.slice(0, 8)) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'opt-btn learn-q'; b.textContent = stripMarkdown(entry.q);
    b.addEventListener('click', () => {
      els.askInput.value = entry.q;
      showMode('ask');
      doAsk();
    });
    els.learnQuestions.appendChild(b);
  }
  els.learnEmpty.hidden = rows.length > 0 || rec.questions.length > 0;
}

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
// The Practice track a level/score belongs to (v2.5). Quiz subjects
// keep their own key ('English', 'Math', ...); grade words share the
// 'Word' key across grades (the same as quiz subjects already share a
// key across grades); Oxford has its own key so its level never
// collides with the grade-word level.
function practiceKey() {
  return els.gradeSel.value === 'Oxford' ? 'Oxford' : els.subjectSel.value;
}
function levelFor(key) {
  const lv = getLevels();
  return lv[key] || { difficulty: 'easy', streak: 0 };
}
function setLevel(key, difficulty, streak) {
  const lv = getLevels();
  lv[key] = { difficulty, streak };
  saveLevels(lv);
}

// Picker interlock (v2.5): Oxford is a word track, not a grade —
// picking it forces Subject to Word, shows the Level picker (1–20,
// saved on the phone), and hides Term (words have no term). Picking
// Subject Word for a grade also hides Term; quiz subjects show it.
// v2.6.1: leaving Oxford restores the subject Oxford replaced — the old
// code overwrote it with 'Word' and never put it back, so Oxford -> P3
// left Subject stuck on Word with Term hidden. The transition lives in
// nextPracticePickers (pickers.js, pure) so Node can test it.
let oxfordLevel = 1;
try {
  const n = Number(localStorage.getItem('psa-oxford-level'));
  if (n >= 1 && n <= 20) oxfordLevel = n;
} catch (_) {}
let pickerState = { wasOxford: false, preOxfordSubject: 'English' };
function updatePracticePickers() {
  const next = nextPracticePickers(pickerState, els.gradeSel.value, els.subjectSel.value);
  pickerState = { wasOxford: next.wasOxford, preOxfordSubject: next.preOxfordSubject };
  els.subjectSel.value = next.subject;
  els.subjectSel.disabled = next.subjectDisabled;
  els.oxfordLevelSelWrap.hidden = next.levelHidden;
  els.termSelWrap.hidden = next.termHidden;
  if (els.oxfordLevelSel) els.oxfordLevelSel.value = String(oxfordLevel);
}
els.gradeSel.addEventListener('change', onPracticePickerChange);
els.subjectSel.addEventListener('change', onPracticePickerChange);
els.termSel.addEventListener('change', onPracticePickerChange);
els.oxfordLevelSel.addEventListener('change', () => {
  const n = Number(els.oxfordLevelSel.value);
  if (n >= 1 && n <= 20) {
    oxfordLevel = n;
    try { localStorage.setItem('psa-oxford-level', String(n)); } catch (_) {}
  }
  onPracticePickerChange();
});
updatePracticePickers();

async function loadBank(grade, subject, term, oxLevel) {
  const key = `${grade}-${subject}-${term}-${oxLevel || ''}`;
  if (bankKey === key) return;
  if (subject === 'Word' && grade === 'Oxford') {
    // Oxford words (v2.5): the picked level's words as meaning
    // questions — "What does "word" mean?" with 4 definitions.
    const ox = await loadOxfordWords();
    bank = buildWordBank(wordsByLevel(ox, oxLevel), { subject: 'Word', grade: 'Oxford', idPrefix: 'oxford' });
  } else if (subject === 'Word') {
    // Class words for the grade (v2.5): the words.json 'Vocabulary'
    // entries — the class words, already in this repo (no new file).
    const dict = await loadWords();
    bank = buildWordBank(wordsByGradeVocabulary(dict, grade), { subject: 'Word', grade, idPrefix: 'word' });
  } else {
    const n = grade.slice(1);
    const resp = await fetch(`./data/quiz/quiz_p${n}_${SUBJECT_FILE[subject]}.json`);
    if (!resp.ok) throw new Error(`Could not load ${subject} questions (${resp.status})`);
    bank = filterByTerm(await resp.json(), term);
  }
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
  // v2.5: do not re-ask items answered correctly in the last 7 days
  // (records.js) — progress continues instead of looping the same
  // questions. When everything left was recently answered correctly,
  // the pool stays as it is, so Practice never runs dry.
  const fresh = pool.filter((it) => !isRecentlyCorrect(recentCorrect, it.id, todayStr()));
  if (fresh.length) pool = fresh;
  const item = pool[Math.floor(Math.random() * pool.length)];
  recentIds.push(item.id);
  if (recentIds.length > 12) recentIds.shift();
  return item;
}


function renderQuestion(item) {
  current = { item, userAnswer: null };
  practiceBoard.clear();
  const lv = levelFor(practiceKey());
  const grade = els.gradeSel.value;
  const subject = els.subjectSel.value;
  const extra = grade === 'Oxford' ? ` · Oxford Level ${oxfordLevel}`
    : (subject !== 'Word' && els.termSel.value !== 'all' ? ` · ${els.termSel.value}` : '');
  els.quizMeta.textContent = `${grade} · ${subject}${extra} · ${item.difficulty} · Level: ${lv.difficulty}`;
  els.quizStars.textContent = '★'.repeat(Math.min(5, lv.streak)) + '☆'.repeat(Math.max(0, 5 - Math.min(5, lv.streak)));
  els.quizPassage.hidden = !item.passage;
  if (item.passage) els.quizPassage.textContent = stripMarkdown(item.passage);
  els.quizQuestion.textContent = stripMarkdown(item.question);
  els.quizResult.hidden = true;
  const area = els.quizAnswerArea;
  area.innerHTML = '';
  els.checkBtn.disabled = false;
  els.nextBtn2.hidden = true;

  if (item.type === 'multiple_choice') {
    const list = document.createElement('div');
    list.className = 'opt-list';
    for (const opt of item.options || []) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'opt-btn'; b.textContent = stripMarkdown(opt);
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
      lab.htmlFor = cb.id; lab.textContent = stripMarkdown(opt);
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
  // Second Next button (v2.6): right next to Check, so the child can go
  // on without scrolling past the chalkboard. Hidden again by
  // renderQuestion; the button under the board stays as well.
  els.nextBtn2.hidden = false;
  // Mark the chosen options. The displayed text is stripped of markdown
  // markers (v2.4), so both sides are stripped before comparing — a
  // "**cold**" option must still match the "**cold**" answer.
  els.quizAnswerArea.querySelectorAll('.opt-btn').forEach((b) => {
    b.disabled = true;
    if (normAnswer(stripMarkdown(b.textContent)) === normAnswer(stripMarkdown(item.answer))) b.classList.add('correct');
    else if (b.getAttribute('aria-pressed') === 'true') b.classList.add('wrong');
  });
  els.quizAnswerArea.querySelectorAll('input').forEach((i) => { i.disabled = true; });
  els.quizVerdict.textContent = ok ? 'Correct! Well done!' : 'Not yet — look at the steps.';
  els.quizVerdict.className = `verdict ${ok ? 'good' : 'bad'}`;
  els.quizCorrect.textContent = ok ? '' : `The answer is: ${stripMarkdown(item.answer)}`;
  const steps = stepsOf(item);
  els.quizResult.hidden = false;
  // Chalkboard ONLY: the same verified steps, one at a time. (v2.2 — the
  // static "How to get it" list showed the same steps twice.)
  practiceBoard.show(steps);

  // Adaptive: right → streak up, two in a row moves one level up;
  // wrong → stay on the same concept (unit), same or one level down.
  const key = practiceKey();
  const lv = levelFor(key);
  const nl = nextLevel(lv, ok);
  setLevel(key, nl.difficulty, nl.streak);
  if (ok) retryUnit = null; else retryUnit = item.unit || null;
  // v2.5: every answered question goes into the phone-only record
  // (per-subject average), and a correct answer is remembered for 7
  // days so the question is not asked again for a while.
  saveRecord((rec) => recordPracticeAnswer(rec, key, ok, todayStr()));
  if (ok) {
    recentCorrect = markCorrect(recentCorrect, item.id, todayStr());
    saveRecentCorrectMap();
  }
}

async function nextQuestion() {
  const key = practiceKey();
  const lv = levelFor(key);
  let item;
  if (retryUnit) {
    // Same concept, a different type if possible, same or easier level.
    item = pickQuestion(key, { unit: retryUnit, notType: current?.item.type });
    if (item.unit !== retryUnit) retryUnit = null;
  } else {
    item = pickQuestion(key, { difficulty: lv.difficulty });
  }
  renderQuestion(item);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// Start a quiz from the current pickers (v2.6): extracted from the old
// inline Start handler so a picker change mid-quiz can use the same path
// — reload the bank for the new selection, reset the run, show the quiz.
async function startPractice() {
  // Practice needs no AI model — only the question bank. ("Say it simpler"
  // loads the model on demand.) Do not gate practising behind the download.
  try {
    await loadBank(els.gradeSel.value, els.subjectSel.value, els.termSel.value, oxfordLevel);
  } catch (e) {
    alert(e.message);
    return;
  }
  recentIds = [];
  retryUnit = null;
  loadRecentCorrectMap();
  els.quizWrap.hidden = false;
  nextQuestion();
}

// Picker change (v2.6): before Start it only updates the picker
// interlock (Oxford forces Word, hides Term). While a quiz is running,
// the same change reloads the bank and starts a fresh question from the
// new selection, so the child never has to go back to change grade,
// subject or term. updatePracticePickers runs first so the forced
// subject (Oxford -> Word) is what loadBank reads.
function onPracticePickerChange() {
  updatePracticePickers();
  if (!els.quizWrap.hidden) startPractice();
}

els.startBtn.addEventListener('click', startPractice);
els.checkBtn.addEventListener('click', doCheck);
els.nextBtn.addEventListener('click', nextQuestion);
els.nextBtn2.addEventListener('click', nextQuestion);
els.simplerBtn.addEventListener('click', async () => {
  if (!current) return;
  els.simplerBtn.disabled = true;
  try {
    await ensureModels();
    // The full steps (hint + explanation), not the explanation alone:
    // a fragment like "smart - smarter - smartest." gives the model
    // nothing to rephrase — it answered that with a greeting (Bug 1).
    const steps = stepsOf(current.item);
    const text = await saySimpler(steps.join(' '));
    // The model still greets, echoes or invents (see practice.js), so
    // only a rewording that keeps the steps' own content words goes on
    // the board; anything else falls back to the original steps.
    const simple = simplerBoardSteps(text, steps);
    practiceBoard.show(simple.length ? simple : steps);
  } catch (e) {
    alert('First get the teacher using the button at the top, then try again.');
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
