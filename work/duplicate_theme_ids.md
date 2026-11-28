# Duplicate Theme ids — investigation (v2.8 build, 2026-11-28)

Measured from the master bank (`~/workspace/word-words-repo/data/quiz_p[1-7]_*.json`,
commit 3995c425, 43,196 items). TU flagged "140 ids appear twice in theme files";
the full picture is bigger.

## Counts (recounted from disk)

| Scope | Duplicated ids | Extra occurrences |
|---|---|---|
| Within one theme file (same id twice in the same file) | 140 | 140 |
| Across theme files (same id in 2–3 files of one grade) | 219 | 239 |
| **Total** | **359** | **379** |

Distinct quiz ids in the bank: 43,196 − 379 = **42,817**.

Within-file duplicates: 7 files × 20 ids each, consecutive id blocks —
`quiz_p1_theme_math.json` TH1378000–TH1378019,
`quiz_p2_theme_math.json` TH2278000–TH2278019,
`quiz_p3_theme.json` TH3314000–TH3314019,
`quiz_p3_theme_social.json` TH3335000–TH3335019,
`quiz_p4_theme.json` TH4162000–TH4162019,
`quiz_p4_theme_math.json` TH4247000–TH4247019,
`quiz_p4_theme_science.json` TH4285000–TH4285019.
The consecutive-20 pattern points to a generator numbering bug (two batches
reusing the same id block), not intentional sharing.

Cross-file duplicates: the theme id namespace is per-grade, not per-file —
e.g. TH1132000 is a maths word question in `quiz_p1_theme_math.json` and a
different social word question in `quiz_p1_theme_social.json`.

**All paired questions differ: 0 same-question pairs** (140/140 within-file,
219/219 cross-file). Every duplicate id is two different questions sharing
one id — never an exact-duplicate item. (The audit's 254 exact duplicates
were a different, already-handled set.)

## How item/chunk ids are used (read in the v2.8 code)

- **RAG retrieval (`retrieval.js`, `rag.js`): purely positional.** Chunks are
  addressed by array index; `chunk.id` is never used for lookup. Duplicate
  chunk ids are harmless here.
- **Ask choices (`choices.js`):** `distinctChoices` dedups by label AND by
  `id:${chunk.id}`; `relatedHits` ("More") excludes the answered chunk by id.
  If both twins of one id rank in the top hits, one is dropped from the
  3-choice list / More list. Display effect only — the child still gets
  valid choices; nothing wrong is shown.
- **Practice (`app.js` lines 834–983):** `it.id` keys the just-asked filter
  (`recentIds`) and the 7-day recently-correct skip
  (`isRecentlyCorrect` / `markCorrect`, `psa-recent-correct`). Answering one
  twin correctly marks the other twin as recently correct too, so the twin
  is skipped for 7 days. Soft effect — no wrong answers, no data loss.
- **Precedent:** lesson-qa chunks already share ids by design
  (`LQ-{grade}-{subject}-{title}` — one id per lesson for all its Q&A
  pairs). Non-unique chunk ids are already normal in this index.

## Decision (v2.8 build): NO build-side change

Chunk keys do **not** need to be unique — nothing in the pipeline requires
it. Suffixing later occurrences (e.g. `TH1132000#2`) was considered and
rejected: it would diverge chunk ids from bank item ids (any future
chunk→item mapping by id breaks), contradict the lesson-qa shared-id
convention, fix only the minor `choices.js` display effect, and leave the
Practice-side cross-marking untouched (Practice reads ids from
`data/quiz/*.json`, not from the index). **Both twin questions stay in the
bank and in the index — nothing is silently dropped.** The v2.8 index is
built with the v2.7 flow unchanged; `test_v2_8.mjs` pins the known
duplicate count (distinct quiz ids 42,817) so any future change is visible.

## Recommended bank-level fix (needs a Won/TU decision — NOT done here)

Renumber the duplicate ids in the theme files: assign fresh, unused ids to
the later occurrence of each duplicated id (within-file first, then
cross-file), ideally moving to a per-file id namespace so the same id can
never recur across `theme_math` / `theme_science` / `theme_social` of one
grade. That changes bank content, so it is TU's call with Won's go-ahead.
Until then the only user-visible effects are the two soft ones above.
