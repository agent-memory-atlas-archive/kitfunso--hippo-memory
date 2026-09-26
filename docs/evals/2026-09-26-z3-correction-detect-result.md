# Z3 correction detector: result

**Date:** 2026-09-26. **Status:** COMPLETED. **Verdict: FAIL.** Held-out precision is 0.82, under the locked 0.90 bar. Nothing ships; this doc is the deliverable.

Prereg: `docs/evals/2026-09-26-z3-correction-detect-prereg.md`, locked at `3e115b0`. Detector frozen at `716fdd4` (branch `feat/z3-correction-detect`) before the one held-out score. The module, its tests and its export are removed in the commit after this doc, as the prereg requires on a fail. The frozen rule table is in the appendix so the next attempt starts from it.

## Held-out (the verdict)

| | value | 95% Wilson |
|---|---|---|
| Messages | 1,087 (70 sessions) | |
| Labelled corrections | 159 | |
| Detector hits | 61 | |
| True positives | 50 | |
| **Precision** | **0.820** | 0.705 to 0.896 |
| Recall | 0.314 | 0.247 to 0.390 |

The hit floor (20) is met and label agreement (below) clears 80%, so this is a verdict, not a no-verdict. Every hit filled `instruction`; none filled `correctedClaim` (the two rules that fill it did not fire on held-out).

## Tune split (for contrast, not a result)

733 messages (53 sessions), 102 labelled corrections, 52 hits, precision 0.942 (0.844 to 0.980), recall 0.480. The drop from 0.94 to 0.82 is the overfit to the tune split, carried almost entirely by one rule.

## Label check

Opus labelled all 1,820 messages; 261 (14.3%) are corrections. The author hand-labelled 60 tune-split messages blind to the Opus label (40 random, 20 Opus positives). Agreement 58 of 60 (96.7%), Cohen's kappa 0.925. Both disagreements were Opus calling a message a correction that the author did not; neither went the other way.

## Precision by rule, held-out

| rule | hits | correct |
|---|---|---|
| frustration (`dude`, `what the fuck`) | 34 | 25 |
| i-said | 9 | 9 |
| why-did-you | 5 | 5 |
| no-opener | 3 | 3 |
| negative-imperative | 3 | 3 |
| stop-doing | 3 | 2 |
| quality-complaint | 2 | 1 |
| wait-what | 1 | 1 |
| we-are-not | 1 | 1 |

Rules that did not fire on held-out: wrong-claim, you-failed, revert, use-x-not-y, instead-of.

## Error analysis

- **9 of the 11 false hits are the frustration rule.** On the tune split "dude" nearly always marked a correction (20 of 21). On held-out it was often plain address attached to a go-ahead or a question. A swear word or a nickname carries tone, not a correction.
- The other 2: "you keep" inside the user's own request for care, and "stop" plus a gerund inside a UI label the user was describing.
- **Post-hoc only, not a verdict:** without the frustration rule the other rules scored 25 of 27 on held-out (0.93, Wilson 0.77 to 0.98). That subset was chosen after seeing held-out, so it proves nothing here. It is the hypothesis for the next attempt, which needs fresh sessions to test.
- Recall misses are mostly corrections with no fixed phrasing: a question that doubts a claim, a complaint about output quality, or a new order that overrides a plan without saying "no".

## What Z2 should take from this

1. On this corpus, rules looked precise only on explicit phrasings (i-said, why-did-you, a leading no or don't): about 0.93, post-hoc. The whole table found under a third of the corrections.
2. Tone words are not evidence. Any rule keyed on swearing or nicknames will write false lessons.
3. The next arm is the explicit-phrasing subset, re-registered and scored on sessions after 2026-09-26, and, per SI4, a Jev judgement arm for the implicit corrections rules cannot read.
4. Whatever ships must keep the interface this slice settled: `(userMessage, previousAssistantText)` in, `{ isCorrection, rule, correctedClaim?, instruction?, confidence }` out, abstaining when there is no previous turn.

## Disclosures

- Before the split existed, the author saw the opening of 15 population messages while profiling the extractor. None were excluded.
- One user wrote every message in the corpus. Even a pass would not show the rules carry to other users.
- The appendix holds only patterns the author wrote, no corpus text. No corpus message is quoted anywhere in this doc.

## Regenerate

Private, outside the repo: `python hippo-archive/z3-correction/extract.py` (population, 1,820 rows), then `node hippo-archive/z3-correction/score.mjs heldout --final` against a build of `716fdd4`.

## Appendix: the frozen rule table (`716fdd4`, first match wins)

| rule | pattern (case-insensitive) | weight |
|---|---|---|
| no-opener | `^(no\|nope\|nah)[,.!\s]+\S+\s+\S` | 0.9 |
| negative-imperative | `^(don't\|dont\|do not\|never\|stop\|quit)\b(?! worry)` | 0.9 |
| wrong-claim | `\b(that's\|thats\|that is\|this is\|it's\|its\|you're\|you are) (wrong\|incorrect\|not right\|not correct\|not what i)` | 0.85 |
| i-said | `\bi (said\|told you\|have said\|already said\|asked for\|meant)\b` | 0.85 |
| we-are-not | `\bwe(?: are\|'re) not\b` | 0.85 |
| why-did-you | `\bwhy (haven't\|havn't\|didn't\|did\|would\|are\|do) you\b` | 0.85 |
| stop-doing | `\bstop \w+ing\b` | 0.85 |
| wait-what | `\bwait,? what\b` | 0.85 |
| frustration | `\b(dude\|what the fuck)\b` | 0.8 |
| quality-complaint | `\b(so ugly\|not good enough\|you keep)\b` | 0.8 |
| you-failed | `\byou (forgot\|missed\|ignored\|broke\|should have)\b` | 0.8 |
| revert | `\b(revert\|undo\|roll back) (that\|this\|it\|those\|these\|the)\b` | 0.8 |
| use-x-not-y | `\buse (.+?),? not (.+?)([.!?,;]\|$)` | 0.8 |
| instead-of | `\binstead of (.+?)([.!?,;]\|$)` | 0.7 |

Gates before any rule: previous assistant turn non-empty (last 2,000 chars), message non-empty and at most 600 chars; rules read the first 300 chars with curly apostrophes normalised.
