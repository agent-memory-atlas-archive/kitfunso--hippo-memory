# Decay default: second registration, fresh seeds (2026-09-24)

**Status:** LOCKED before any run on these seeds. Replaces the guard in `2026-09-24-decay-default-prereg.md`, whose verdict (keep 7 days) stands for seeds 21 to 40. Why the guard changed: `2026-09-24-decay-default-result.md`, "Why the guard failed".

**Openly post hoc:** the new guard was chosen after seeing seeds 21 to 40. That is why it is tested only on seeds 41 to 60, which no run has touched.

## Runs

- Code: the commit that adds this file. Harness: `scripts/e1-lifecycle/run.mjs`, unchanged, with its defaults.
- Seeds: 41 to 60.
- Arms: full@7, full@365, full@730, decay-off (flags as in the first registration).
- Comparisons: `scripts/e1-lifecycle/compare.mjs --seeds 41-60`, 10,000 bootstrap draws.

## Decision rule

HELPS, HURTS and ties are as before: 95% CI clear of 0 and point estimate at least 3 pp. The primary measure is still currentR5.

**Guards.** They are the 2026-09-23 audit's, and all three must pass against full@7:
1. **cleanTrapR5 must not HURT.** On queries with a marked-bad memory competing, finding the current fact with the bad memory absent.
2. **Demoted break-even:** the 95% lower bound of s\* must be above the real-use share of marked-bad memories, 1.4% (29 of 2,119 in the dogfood store).
3. **Superseded break-even:** the 95% lower bound of s\* must be above the real-use superseded share, 7.1% (150 of 2,119).

**Steps**, unchanged from the first registration:
1. A candidate qualifies if it HELPS against full@7 on currentR5 and passes the guards.
2. If none qualifies, keep 7 days.
3. full@730 replaces full@365 only if it HELPS against it.
4. decay-off replaces the chosen half-life only if it HELPS against it and its cleanTrapR5 does not HURT; a tie keeps decay on.

**What a pass allows.** A pass changes the default only for new memories, and only together with the migration and the store-size check declared in the first registration. It does not support any claim against BM25.
