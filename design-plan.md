# Design plan — Primary School AI ("Ask Teacher")

Subject: a friendly offline teacher for Ugandan P1–P7 children. English only.
Audience: children aged ~6–13 on phones, often shared, offline after first download.
Job: (1) answer curriculum questions in short simple English, (2) quiz practice
that adapts like a teacher.

## Palette (6 hex)
- Paper white `#FFFFFF` — background (same clean base as the translator app)
- Leaf green `#2E7D32` — primary (growth, school garden; deliberately NOT the
  translator's blue, so the two apps are easy to tell apart)
- Light leaf `#E8F5E9` — answer card background
- Sunny yellow `#F9AB00` — stars / streak / correct-answer accent
- Ink `#202124` — text
- Muted grey `#5F6368` — secondary text, borders `#DADCE0`

## Type
- System sans only (offline — no webfonts): Roboto, system-ui, sans-serif.
- Question 20px medium; answer 22px medium; body 16px; labels 13–14px grey.
- Sentence case everywhere, plain verbs. Buttons say what happens
  ("Ask the teacher", "Check my answer", "Next question").

## Layout
- Single column, max-width 640px, same skeleton as the translator app
  (topbar with status dot, cards, bottom version line).
- Home: two big tappable mode cards — "Ask a question" and "Practice".
- Ask: input card → answer card (green) with "From the book:" source lines
  underneath, always visible.
- Practice: grade + subject picker → question card → answer UI by type
  (big option buttons / True–False buttons / text input / checkboxes) →
  result with steps (numbered, because a solution really is a sequence) →
  "Next question".
- One bold element: the green teacher header + yellow star streak in
  Practice. Everything else stays quiet and plain.
- Touch targets ≥48px. `[hidden]` always wins over display rules
  (the translator's v1 bug — keep the guard).

## Principles
- One job per screen. No clutter, no decoration that doesn't help a child.
- The verified book text is always shown next to any AI wording, so a
  wrong rephrase is checkable.
- Failure/empty states give direction ("Ask your teacher" refusal;
  "Pick a grade and subject to start").

## Review vs brief
- Not a SaaS card kit: cards differ by role (green answer card, white
  question card, yellow star row) rather than one radius/shadow everywhere.
- Not cream+serif+terracotta: white + green + system sans, chosen for a
  schoolbook, not a brochure.
- No ALL-CAPS eyebrow labels, no numbered markers except real sequences
  (solution steps).
