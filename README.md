# Ask Teacher — offline primary-school AI (English, P1–P7)

Live: https://grace39237-sys.github.io/primary-school-ai/

A small offline teacher for Ugandan primary school children. It answers
questions in short simple English from the school books, and it quizzes
children like a teacher: step-by-step working, easier questions after a
wrong answer, harder ones after a right answer.

## How it works

- **Ask:** the child's question is embedded with MiniLM (22MB) and matched
  against a prebuilt index of 54,186 curriculum chunks (quiz explanations,
  class-word definitions, lesson summaries, lesson practice Q&A). If the
  best match is too weak, the app refuses WITHOUT calling the model
  ("I don't know that yet — ask your teacher"). Otherwise SmolLM2-135M
  (q4f16, ~112MB) answers in 1–2 short sentences using only the matched
  text. The answer is always shown next to its source sentence from the
  book, so a wrong rephrase is checkable.
- **Practice:** questions come straight from the quiz bank
  (44,467 items, P1–P7, English/Maths/Science/Social). Types supported:
  multiple choice, true/false, fill in the blank, comprehension,
  multi-select. The explanation is shown as numbered steps (the verified
  working from the book — the model never writes maths steps; "Say it
  simpler" only rephrases the explanation). Level per subject is saved on
  the phone only: right twice in a row moves one difficulty up; wrong
  keeps the same concept (unit) with a different question or type.
- **Offline:** models + index are cached on first use; after that the app
  works with no internet. First download about 200MB (models ~134MB +
  index ~30MB + shell ~33MB).

## Stack

Same proven stack as the offline translator app
(`~/workspace/offline-translator/`): transformers.js 3.8.1 vendored
(+ onnxruntime-web), GitHub Pages, service worker. The service worker
deletes only its own old shell caches on activate — it NEVER touches
`transformers-cache`, where the models live (the translator's v6 bug).

## Files

- `index.html`, `styles.css`, `app.js` — UI + Ask + Practice
- `rag.js` — MiniLM embedding + int8 index search
- `ai.js` — SmolLM2-135M text generation
- `data/index.json` + `data/index.bin` — prebuilt RAG index (int8 vectors)
- `data/quiz/quiz_p*.json` — the quiz bank for Practice mode
- `work/build_index.mjs` — rebuilds the index from
  `~/workspace/word-words-repo/` (recounts first — math OX items were
  removed 2026-11-24; current total 44,467 quiz items)
- `work/calibrate_threshold.mjs` — picks the refusal threshold from the
  built index using the 16 model-test questions

## Verification

- Node: index counts match the current files; retrieval returns the right
  chunks for the 16 model-test questions; refusal threshold calibrated.
- Browser smoke test on the `-check` repo: q4f16 must load and answer in
  a real browser (the Node test ran int8 — q4f16 in the browser is unproven
  until this passes).

## Design decisions (from primary-school-ai-model-test.md)

- 135M beat Qwen 0.5B in the side-by-side test (5/12 clean answers vs
  2/12, 4.5s vs 14.9s) — Qwen is not used.
- Refusal is by retrieval score, never by the model: small models invent
  answers when asked to refuse.
- Fine-tuning (LoRA on quiz Q&A pairs) is step 2, after this v1 is verified.
