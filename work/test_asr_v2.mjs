// test_asr_v2.mjs — Node smoke test for the tutor v2 ASR code.
// Run from ~/workspace/primary-school-ai/work: node test_asr_v2.mjs
// Audio: the translator's test files (16kHz float32 raw).
//
// NOTE on what this test can and cannot prove:
// The browser runs the VENDORED transformers.web.min.js (3.8.1). That
// bundle imports 'onnxruntime-common'/'onnxruntime-web' through the HTML
// importmap, so its ONNX session creation only works in a browser — in
// Node it throws "Cannot read properties of undefined (reading 'create')"
// at from_pretrained. So the Node test:
//   (1) imports the REAL pure helpers from the shipped files
//       (hasLatin from asr.js, collapseRepeats from textutil.js),
//   (2) runs the SAME loader/transcribe code as asr.js (manual
//       MoonshineProcessor, dtype 'q8', same generate params) against
//       the npm build of the identical library version (3.8.1), and
//   (3) statically checks asr.js contains the expected loader calls.
// The live-browser check (parent) is the real proof for the browser path.
import { hasLatin } from '../asr.js';
import { collapseRepeats } from '../textutil.js';
import {
  AutoModelForSpeechSeq2Seq,
  AutoTokenizer,
  AutoFeatureExtractor,
  MoonshineProcessor,
  env,
} from '@huggingface/transformers';
import fs from 'node:fs';

env.cacheDir = './.cache-asr';
env.allowLocalModels = false;

function loadRaw16k(path) {
  const buf = fs.readFileSync(path);
  const f32 = new Float32Array(buf.length / 4);
  for (let i = 0; i < f32.length; i++) f32[i] = buf.readFloatLE(i * 4);
  return f32;
}

function assert(cond, label) {
  console.log(`${cond ? 'PASS' : 'FAIL'} — ${label}`);
  if (!cond) process.exitCode = 1;
}

console.log('=== pure-function checks (shipped files) ===');
assert(collapseRepeats('What is a noun? What is a noun?') === 'What is a noun?', 'collapseRepeats: repeated sentence → one');
assert(collapseRepeats('hello hello hello') === 'hello', 'collapseRepeats: repeated phrase → one');
assert(collapseRepeats('What is a noun?') === 'What is a noun?', 'collapseRepeats: clean text unchanged');
assert(hasLatin('What is a noun?') === true, 'hasLatin: English → true');
assert(hasLatin('안녕하세요') === false, 'hasLatin: no Latin letters → false');
assert(hasLatin('') === false, 'hasLatin: empty → false');

console.log('\n=== static checks on asr.js ===');
const asrSrc = fs.readFileSync('../asr.js', 'utf8');
for (const s of ['MoonshineProcessor', "dtype: 'q8'", 'onnx-community/moonshine-base-ONNX', "language: 'english'", 'collapseRepeats']) {
  assert(asrSrc.includes(s), `asr.js contains ${s}`);
}

// Same loader as asr.js, against the npm build of transformers 3.8.1.
async function loadASR(modelId) {
  const t0 = Date.now();
  const [model, tokenizer, fe] = await Promise.all([
    AutoModelForSpeechSeq2Seq.from_pretrained(modelId, { dtype: 'q8' }),
    AutoTokenizer.from_pretrained(modelId),
    AutoFeatureExtractor.from_pretrained(modelId),
  ]);
  const processor = new MoonshineProcessor({}, { tokenizer, feature_extractor: fe });
  console.log(`model load: ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  return { model, processor };
}

async function transcribe(asr, audio) {
  const inputs = await asr.processor(audio);
  const max_new_tokens = Math.max(32, Math.floor((audio.length / 16000) * 16));
  const outputs = await asr.model.generate({ max_new_tokens, language: 'english', task: 'transcribe', ...inputs });
  return collapseRepeats(asr.processor.batch_decode(outputs, { skip_special_tokens: true })[0].trim());
}

console.log('\n=== load base-en: onnx-community/moonshine-base-ONNX ===');
const asr = await loadASR('onnx-community/moonshine-base-ONNX');

const cases = [
  { file: '/home/hatch/workspace/offline-translator/work/child_q.raw', expected: 'What is a noun?' },
  // Known limitation (documented in the v2 design note): the place name
  // "Soroti" is misheard as "Sarota" by both tiny and base models — that
  // is exactly why the recognized text goes into an editable field first.
  { file: '/home/hatch/workspace/offline-translator/work/en_test.raw', expected: 'Hello. I run a school in Sarota, Uganda. I think it will rain tomorrow.' },
];

for (const c of cases) {
  const audio = loadRaw16k(c.file);
  console.log(`\n### ${c.file}: ${audio.length} samples (${(audio.length / 16000).toFixed(2)}s)`);
  const t1 = Date.now();
  const text = await transcribe(asr, audio);
  console.log(`transcribe time: ${((Date.now() - t1) / 1000).toFixed(1)}s`);
  console.log(`expected: ${JSON.stringify(c.expected)}`);
  console.log(`got     : ${JSON.stringify(text)}`);
  assert(text === c.expected, `exact match: ${c.file.split('/').pop()}`);
}
console.log('\nDONE');
