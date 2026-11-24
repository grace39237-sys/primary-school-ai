// asr.js — Moonshine speech recognition for the Ask teacher (English only).
//
// Same manual-processor approach as the translator app: pipeline() cannot
// be used for Moonshine repos (no processor_class in preprocessor_config,
// so AutoProcessor returns a tokenizer-less default and decoding fails).
// The model, tokenizer and feature extractor are loaded directly and a
// MoonshineProcessor is assembled by hand — the same flow as
// transformers.js _call_moonshine.
//
// Model: onnx-community/moonshine-base-ONNX, int8 (q8).
// Verified files (Hugging Face API, 2026-11-24):
//   encoder_model_quantized.onnx 19.6MB + decoder_model_merged_quantized.onnx
//   40.5MB + tokenizer.json 3.6MB ≈ 64MB total.
import {
  AutoModelForSpeechSeq2Seq,
  AutoTokenizer,
  AutoFeatureExtractor,
  MoonshineProcessor,
} from './vendor/transformers.web.min.js';
import { collapseRepeats } from './textutil.js';

export const ASR_MODEL_EN = 'onnx-community/moonshine-base-ONNX';

// 16 tokens/sec: the translator's Node tests showed 6/s truncates
// sentences; 16/s gives complete utterances.
const TOKENS_PER_SEC = 16;

let asr = null;

export async function loadASR(onProgress) {
  if (asr) return asr;
  const [model, tokenizer, featureExtractor] = await Promise.all([
    AutoModelForSpeechSeq2Seq.from_pretrained(ASR_MODEL_EN, { dtype: 'q8', progress_callback: onProgress }),
    AutoTokenizer.from_pretrained(ASR_MODEL_EN, { progress_callback: onProgress }),
    AutoFeatureExtractor.from_pretrained(ASR_MODEL_EN, { progress_callback: onProgress }),
  ]);
  const processor = new MoonshineProcessor({}, { tokenizer, feature_extractor: featureExtractor });
  asr = { model, processor };
  return asr;
}

// audio16k: Float32Array, 16kHz mono. Returns the cleaned transcript.
export async function transcribe(audio16k) {
  const a = await loadASR();
  const inputs = await a.processor(audio16k);
  const max_new_tokens = Math.max(32, Math.floor((audio16k.length / 16000) * TOKENS_PER_SEC));
  const outputs = await a.model.generate({
    max_new_tokens,
    language: 'english',
    task: 'transcribe',
    ...inputs,
  });
  return collapseRepeats(a.processor.batch_decode(outputs, { skip_special_tokens: true })[0].trim());
}

// Language guard: English mode needs Latin letters. A transcript with no
// Latin letters is noise or another language — do not send it to Ask.
export function hasLatin(text) {
  return /[A-Za-z]/.test(text || '');
}
