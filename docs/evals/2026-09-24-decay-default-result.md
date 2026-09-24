# Decay default: result (2026-09-24)

**Registration:** `2026-09-24-decay-default-prereg.md` (locked at `68b90af`, before any run). **Raw outputs:** `2026-09-24-decay-default-raw.txt`. **Code under test:** `68b90af`, one `dist/` build, seeds 21 to 40, 120 runs, local CPU only.

## Verdict by the locked rule: the default stays at 7 days

Every candidate HELPS against 7 days on the primary measure, currentR5 (whether the current version of a fact is in the top five), by about 46 points. Every candidate also fails the guard as written: the rate at which a memory marked bad stays in the top five HURTS against 7 days. Step 2 of the rule then applies: with no qualifier, the default stays 7 days.

| Candidate vs full@7 | currentR5, benefit pp [95% CI] | Trap persistence, benefit pp [95% CI] | Guard | Qualifies |
|---|---|---|---|---|
| full@365 | +45.5 [43.9, 47.1] HELPS | -8.6 [-11.7, -5.4] HURTS | fails | no |
| full@730 | +46.1 [44.5, 47.8] HELPS | -7.3 [-10.7, -4.1] HURTS | fails | no |
| decay-off | +46.1 [44.4, 47.8] HELPS | -5.9 [-9.0, -2.9] HURTS | fails | no |

(Benefit points the good way: for trap persistence, 7-day minus candidate.)

The rest of the rule was never reached. For the record:
- **full@730 vs full@365:** +0.7 [0.1, 1.2]. A tie: it misses the 3-point floor.
- **decay-off vs full@365:** +0.6 [-0.1, 1.4]. A tie.
- **decay-off vs full@730:** 0.0 [-0.5, 0.5]. A tie.

## Reproduction

full@365, full@7, all-off and bm25-static reproduce the 2026-09-23 audit exactly on the 1.45.0 code:
- currentR5 is .747, .292, .692 and .776;
- the L2 gap is +45.5 [43.9, 47.1];
- the gap to BM25 is -48.4 at 7 days and -2.9 at 365.

The 19 files 1.45.0 changed under `src/` did not move E1.

## Why the guard failed, and why that is the guard's fault

The guard counts how often a marked-bad memory stays in the top five. At 7 days that rate is lower (17.1% against 25.7%), but not because bad memories are suppressed better. Everything decays out at 7 days, the correct answer included. On the very queries that have a marked-bad memory competing:

| | full@7 | full@365 | Difference [95% CI] |
|---|---|---|---|
| Current fact found, and the bad memory absent (cleanTrapR5) | 22.2% | 54.9% | +32.7 [28.4, 36.9] |
| Break-even share of queries exposed to a bad memory (s\*) | | | 100% [100, 100] |

So 365 days does better on trap-exposed queries too. The 2026-09-23 audit guarded with s\*, which passes. Guarding with the raw persistence rate rewards a setting for forgetting everything. Writing that guard was a mistake in this registration. It was not in the audit's.

The rule is kept as locked. This file does not change the default. A corrected guard is a new registration (`2026-09-24-decay-default-prereg-2.md`), and it must be confirmed on seeds this campaign has not seen, because this data has now been looked at.

## What else the runs show (descriptive)

- **365 and 730 days tie.** So do 365 days and decay switched off. Nothing here favours a half-life above 365, or switching decay off, over 365.
- **Every arm still loses to BM25 on current-fact recall:**
  - full@365: -2.9 [-4.3, -1.4];
  - full@730: -2.2;
  - decay-off: -2.3.

  Every arm suppresses marked-bad memories far better than BM25 (about -48 to -51 points of trap persistence). The critique's dating caveat from the audit still applies to both.
- **The one cost of the longer half-life is superseded versions.**
  - Stale intrusion rises from 41.8% to 87.6%, near BM25's 90.4%.
  - On queries exposed to a superseded version, 7 days does better: cleanStaleR5 -12.6.
  - The audit's break-even says 365 still wins unless about 80% of queries face a superseded version. The dogfood store's real rate is 7.1%.

## NOT-DONE

- The confirmation on fresh seeds under the corrected rule.
- The migration for memories stored at 7 days.
- The store-size check with sleep on.
- The lane with lookalikes dated inside each fact's window.
