// ai.js — SmolLM2-135M-Instruct, text generation for the Ask teacher and
// for rephrasing explanations in Practice mode ("Say it simpler").
// The model is small (int8, ~129MB) and runs in the browser with ORT Web
// WASM. (q4f16 was tried first but fails on the WASM backend: its float16
// outputs mismatch the float32 the runtime expects. int8 is the fix.)
// Node side-by-side test used (see primary-school-ai-model-test.md).
//
// IMPORTANT: the model only ever rephrases text we already retrieved.
// It must never invent facts, and it must never compute maths steps:
// refusal is decided by the retrieval score in app.js, before the model
// is even called.
import { pipeline } from './vendor/transformers.web.min.js';

export const GEN_MODEL = 'onnx-community/SmolLM2-135M-Instruct-ONNX';

let gen = null;

export async function loadGenerator(onProgress) {
  if (gen) return gen;
  gen = await pipeline('text-generation', GEN_MODEL, { dtype: 'q8', progress_callback: onProgress });
  return gen;
}

// System prompt from the model test — WITHOUT the strong refusal clause.
// The probe showed the strong clause makes small models refuse everything;
// refusal is done by retrieval score instead, so the model only answers
// from text we know is relevant.
export const SYSTEM_ASK = 'You are a friendly teacher for primary school children in Uganda. Answer in 1 or 2 short, simple English sentences. Use ONLY the information in the lesson text. Do not guess or add facts.';

// System prompt for "Say it simpler" — the rewording must start with
// the rewritten text and never greet (the old wording let the model
// answer a fragmentary explanation with "I'm ready to help you with
// your questions."). Even this wording is not reliable on its own:
// practice.js simplerBoardSteps checks the output against the steps
// and falls back to the original steps when the model fails.
export const SYSTEM_SIMPLE = 'You are a friendly teacher for primary school children in Uganda. Rewrite the text below in 1 or 2 short, simple English sentences a young child can understand. Start with the rewritten text. Do not greet the child. Do not ask a question. Use ONLY the information given. Do not add facts.';

export function extractAnswer(out) {
  if (Array.isArray(out) && out.length && out[0] && Array.isArray(out[0].generated_text)) {
    const msgs = out[0].generated_text;
    const last = msgs[msgs.length - 1];
    return (last && last.role === 'assistant' ? last.content : msgs.map((m) => m.content).join(' ')).trim();
  }
  if (Array.isArray(out) && out[0] && typeof out[0].generated_text === 'string') {
    return out[0].generated_text.trim();
  }
  return String(out).slice(0, 500);
}

export async function askTeacher(context, question) {
  const g = await loadGenerator();
  const out = await g([
    { role: 'system', content: SYSTEM_ASK },
    { role: 'user', content: `Lesson text: ${context}\n\nQuestion: ${question}` },
  ], { max_new_tokens: 80, do_sample: false });
  return extractAnswer(out);
}

export async function saySimpler(information) {
  const g = await loadGenerator();
  const out = await g([
    { role: 'system', content: SYSTEM_SIMPLE },
    { role: 'user', content: `Text to rewrite: ${information}` },
  ], { max_new_tokens: 80, do_sample: false });
  return extractAnswer(out);
}
