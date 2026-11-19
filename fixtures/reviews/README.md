# Guest-review fixtures (F10)

Synthetic test data for docs/21 §8. **All hotels are fictional**; their IDs,
names, aliases and listing URLs may appear only here, in tests and in docs
(`npm run check:hotel-ids` fails the build otherwise).

| Path | What |
|---|---|
| `src/hotels.json` | Three fictional hotels (two share a brand in different cities): profile + listings in the onboarding CLI's format, plus generator settings and the planted scenarios |
| `src/phrases.json` | Hand-written phrase bank (no LLM): one aspect and one polarity per phrase, so labels are known by construction |
| `generated/` | Output of `node pocketbase/scripts/reviews-fixtures.mjs` (fixed seed). `--check` fails when it is out of date |
| `generated/reviews.jsonl` | Every review with its ground truth: aspects, sentiment, 1–5 rating, expected status, scenarios |
| `generated/csv/` | The same reviews as import files (generic format; one Persian file with Jalali dates) and an update file with edits and deletions |
| `generated/mentions.jsonl` | Mentions without hotel context with the matcher's expected verdict |
| `generated/eval-synthetic.jsonl` | 200 labelled reviews for the analysis eval (`pocketbase/scripts/reviews-eval.mjs`); 10 carry an injected instruction |
| `generated/eval-synthetic-check.json` | The 20% sample a person checks |
| `eval/results/` | Eval reports; the first line names the set and the method |
| `eval/human/` | Slot for ≥ 50 real reviews labelled by a person (empty until the owner supplies them) |

Personal data in the texts is a placeholder (`{PHONE}`, `{EMAIL}`, `{NID}`):
tests fill it with values generated at run time, so no such number is stored
in the repository.

**Limitation:** template texts are simpler than real reviews; accuracy measured
on them is optimistic. Every accuracy number in a report must say which set it
comes from (`synthetic` here, or `human` from `eval/human/`).
