# Z3 correction detector: pre-registration

**Date:** 2026-09-26. **Status:** PRE-REG-LOCKED at the commit that adds this file. No detector output is compared with a label before that commit.

## Question

ROADMAP Part XV, Z3: a user message that corrects the agent is the strongest signal hippo has. Can a rule-based detector, with no model call, find those messages with precision high enough to turn each hit into a lesson? A false hit becomes a false lesson, so precision is the bar and recall is reported only.

## Mechanism claim

`detectCorrection(userMessage, previousAssistantText)` in `src/correction-detect.ts` returns `{ isCorrection, correctedClaim?, instruction?, confidence }`. It fires on a small set of explicit correction phrasings and abstains otherwise.

## (a) Source-read

- `src/capture.ts:648` `isNonHumanUserLine(entry, content)`: skips `isMeta`, `isSidechain`, `isCompactSummary` and Claude Code command lines. The corpus extractor applies the same skips, plus `promptSource: "system"` lines and lines that open with a tag (`<task-notification>`, `<system-reminder>`), which Part XV Z0 names as the gap in that filter.
- The detector is a new pure module. It reads no store and writes nothing. Hook wiring and store writes come with Z2, after Z1, through SI4's write contract.

## (b) Dry-run

Synthetic pair: assistant "I'll delete the old migrations folder." then user "no, don't delete it, archive it instead". The detector must return `isCorrection: true`. The user message "yes, go ahead" after the same turn must return `false`. Both are unit tests in `tests/correction-detect.test.ts`.

## Data

- **Corpus:** the frozen copy `hippo-archive/transcripts-since-2026-09-01/` (135 transcript files, outside the repo; the private extractor sits beside it at `hippo-archive/z3-correction/extract.py`).
- **Unit:** one human-typed user message plus the assistant text since the previous human message (last 2,000 characters). Tool results, system lines, sidechains and tag-opened lines are dropped. Exact (message, context) duplicates are dropped.
- **Population:** 1,820 messages from 123 sessions, shuffled with a fixed seed. All of them are labelled, so the "random sample" is the whole population.
- **Split, by session** so one session's phrasing cannot sit on both sides: a session is held-out when `int(sha256("z3:" + session_id)[:8], 16) % 2 == 1`. Held-out: 1,087 messages, 70 sessions. Tune: 733 messages, 53 sessions.

## Labels

- **Labeller:** Opus sub-agents, blind to the detector. Each reads batches of messages with their preceding assistant text and answers `correction` or `not`.
- **Definition given to the labeller:** a correction is a message that tells the agent something it just did, said, proposed or assumed is wrong or unwanted, or tells it to change course against that ("no, don't...", "stop...", "use X not Y", "that's wrong, it's...", "I said...", "why did you X? revert it"). Not corrections: new tasks, approvals, questions that seek information, picking one of the agent's offered options, and added scope ("also do X") that does not contradict what the agent did.
- **Label check:** the author hand-labels 60 tune-split messages blind to the Opus label (40 random, 20 drawn from Opus positives) and reports raw agreement and Cohen's kappa. The check stays on the tune split so the author, who also writes the rules, never reads a held-out message before the freeze. The split is random by session, so labeller quality there stands for held-out. Under 80% raw agreement means no verdict, only the census.
- Only aggregate numbers leave the private folder. Test fixtures in the repo are synthetic.

## Procedure

1. Lock this file.
2. Label all 1,820 messages.
3. Tune the rules on the tune split only. The held-out labels are not read, printed or scored while tuning.
4. Freeze the detector in a commit, then score it once on held-out.

## Metrics (held-out, labelled data)

- **Precision (primary):** labelled corrections among detector hits.
- **Recall (reported):** detector hits among labelled corrections.
- 95% Wilson intervals on both.

## Decision rule (locked)

- **Ships** (exported with tests, no hook, no store write) when held-out precision is at least 0.90 on at least 20 detector hits, and label agreement is at least 80%.
- **Fails** when precision is under 0.90 on 20 or more hits. The result doc is then the deliverable and the module does not ship.
- **No verdict** when the detector makes fewer than 20 held-out hits, or label agreement is under 80%.
- Recall has no floor here. A low-recall, high-precision detector is still useful for Z3, since a missed correction costs nothing and a false one teaches the wrong lesson. The result reports recall so Z2 knows what share of corrections it will see.
- The lower Wilson bound is reported beside the point estimate; the bar is on the point estimate. At 20 hits and 0.90, that bound is about 0.70, so a pass at the floor is a weak pass and the result says so.
- `correctedClaim` and `instruction` are not scored here. The result reports how often each is filled on held-out hits; their quality is judged when Z2 writes lessons.
- The detector returns `false` when there is no previous assistant text: with nothing to correct, a "don't X" is a fresh instruction.

## Retraction conditions

- A held-out label or message is found to have shaped a rule: retract the verdict and re-split on fresh sessions.
- A detector change after the freeze commit: the held-out score no longer applies.

## Results

In `docs/evals/2026-09-26-z3-correction-detect-result.md`.
