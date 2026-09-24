# Decay default: pre-registration (2026-09-24)

**Status:** LOCKED before any run. Commits after this one may add results but may not change this file.

**Why:** the 2026-09-23 mechanism audit found the shipped 7-day half-life finds the current fact 29.2% of the time on E1, against 77.6% for BM25, and that 365 days beats 7 by 45.5 pp. It blocked a default change until four checks were done (`2026-09-23-mechanism-audit-result.md`, Proposals, decay default): a re-run on release code, decay-off and 730-day arms, a migration plan, and a store-size check with sleep on. This file declares the first two and how the result decides the default.

## Code and runs

- Code: this branch's head at the commit that adds this file (1.45.0 plus this branch). One `dist/` build serves every run.
- Harness: `scripts/e1-lifecycle/run.mjs`, unchanged. Defaults: 300 facts, 20 sessions, 10 distractors per fact. Seeds 21 to 40.
- Arms:

| Arm | Command flags |
|---|---|
| full@7 | `--arms full --half-life 7` |
| full@365 | `--arms full --half-life 365` |
| full@730 | `--arms full --half-life 730` |
| decay-off | `--arms decay-off` (A1: also switches off slow outcome decay and the read-side boost) |
| all-off | `--arms all-off` |
| bm25-static | `--arms bm25-static` |

- Comparisons: `scripts/e1-lifecycle/compare.mjs`, final epoch, 10,000 bootstrap draws.

## Decision rule

The audit's rule, unchanged: HELPS means the 95% CI lower bound is above 0 and the point estimate is at least +3 pp; HURTS is the mirror; anything else is a tie.

- **Primary:** currentR5.
- **Guard:** trap persistence (a memory marked bad staying in the top five). A candidate whose trap persistence HURTS against full@7 is rejected.

Steps:
1. A candidate among full@365, full@730 and decay-off qualifies if it HELPS against full@7 on currentR5 and passes the guard.
2. If none qualifies, the default stays 7 days.
3. Among qualifiers, full@730 replaces full@365 only if it HELPS against full@365. Otherwise 365, the shorter value, is kept: store size and stale-fact exposure both grow with the half-life.
4. decay-off replaces the chosen half-life only if it HELPS against it on currentR5 and its trap persistence does not HURT against it. A tie keeps decay on, because decay-off also removes outcome feedback's slow path (A1) and makes strengthening a no-op.

Reported beside the verdict, not deciding it: stale intrusion, contradiction intrusion, hotR5, nonStaleR5, and each arm against bm25-static.

## Not declared here

- The lane with lookalikes dated inside each fact's own window. It is needed before any claim against BM25, not before this default change.
- The physics cosine-only lane.
- LongMemEval. Decay does not act within a one-shot benchmark.

## Migration and store size (declared method)

- **Migration:** a memory whose `half_life_days` still equals the old base, adjusted only by the multipliers hippo applies at write (layer, tags, confidence), is rescaled by new base divided by old base. Every rescale is logged in the audit trail with the old value, so it can be undone. The migration is idempotent.
- **Store size:** sleep deletes below strength 0.05, which takes 4.3 half-lives. Growth at the chosen half-life is computed from the dogfood store's capture rate (2,119 memories). It is then compared with the 10k-memory scale measurement (ROADMAP: 1.2 KB each, recall 0.58 s). The dormant store's 180-day retention still applies.
