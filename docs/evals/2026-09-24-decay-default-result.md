# Decay default: result (2026-09-24)

**Outcome: the default moves to 365 days.** The first registration, seeds 21 to 40, kept 7 days, because its guard was mis-specified; that verdict stands for those seeds. The second registration, seeds 41 to 60, uses the audit's own guards and selects 365 days. See "Second registration" at the end.

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

## Second registration: seeds 41 to 60

`2026-09-24-decay-default-prereg-2.md` was locked at `a6482a0` before any run on these seeds. The runs used the `dist/` build from that commit. The migration code added afterwards was built into `dist/` while the runs were in progress, but no file in E1's import graph (33 files, dynamic imports included) changed. Raw outputs are appended to `2026-09-24-decay-default-raw.txt`.

| Step | Comparison | Measure | Benefit, pp [95% CI] | Verdict |
|---|---|---|---|---|
| 1 | full@365 vs full@7 | currentR5 | +45.6 [43.8, 47.4] | HELPS |
| 1 | guard | cleanTrapR5 | +33.9 [28.8, 39.3] | does not hurt |
| 1 | guard | demoted s\*, 95% lower bound | 100% > 1.4% | passes |
| 1 | guard | superseded s\*, 95% lower bound | 77.2% > 7.1% | passes |
| 1 | full@730 and decay-off vs full@7 | currentR5 | +46.3 and +46.3 | both qualify |
| 3 | full@730 vs full@365 | currentR5 | +0.7 [0.1, 1.2] | tie, so 365 stays |
| 4 | decay-off vs full@365 | currentR5 | +0.7 [-0.1, 1.4] | tie, so decay stays on |

**Verdict: 365 days.** Shipped in 1.46.0 as `DEFAULT_HALF_LIFE_DAYS = 365` (`src/memory.ts`).

## Migration (declared in the first registration; shipped)

`src/half-life-migration.ts`, run at the start of `hippo sleep`:
- **What moves:** memories whose half-life still equals `deriveHalfLife(7, entry)` move to `deriveHalfLife(365, entry)`.
- **What stays:** memories hippo shortened keep their value (invalidated, superseded, merge sources, marked bad), and so do memories with a fixed half-life (decisions, incidents, customer notes: 90 days).
- **Logging:** the ids go to the audit log (`half_life_migrate`). Migrating back to 7 reverses it.
- **Scope:** new stores record 365 at creation and never migrate. Stores that already hold memories and have no recorded base read as 7 days, and move once.
- **Opting out:** `defaultHalfLifeDays` in `.hippo/config.json` overrides the default; a store whose setting matches its base is left alone.

## Store size (declared method)

Sleep deletes a memory below strength 0.05, which is 4.3 half-lives with no recall:
- **7 days:** about 30 days;
- **365 days:** about 4.3 years.

So at 365 days, sleep's decay step practically stops deleting unused memories, and growth follows the capture rate. The dogfood store's rate is about 12 memories a day (2,119 in roughly 180 days).

| Store | Memories per year | Size per year (2.2 KB each, with mirrors) | Days to 10,000 memories |
|---|---|---|---|
| One developer | about 4,300 | about 9 MB | about 850 |
| Shared server, 50 developers | about 215,000 | about 460 MB | about 17 |
| Shared server, 200 developers | about 860,000 | about 1.8 GB | about 4 |

- **For a single developer's store this is acceptable.** The 10,000-memory measurement (ROADMAP, Capture and scale findings) gives recall in 0.58 s. A 10,000-memory store takes about 2.3 years at this rate.
- **A shared company server is not covered by this default.** It needs Postgres (EI10) and a per-store cap or retention policy before it runs at 365 days (ROADMAP Part XII).
- **The dormant store's 180-day retention is unchanged.**

## Cross-check on a public dataset (undeclared, retrieval only)

On the same free LoCoMo check as `2026-09-24-public-benchmarks-dryrun.md` (all 1,531 questions with evidence, no embeddings):
- **7-day default:** hippo trails BM25 at top 10 by -6.9 pp [-8.5, -5.5].
- **365 days:** the gap narrows to -1.0 [-1.9, 0.0] at top 10 and -1.3 [-2.1, -0.6] at top 50.

Hippo still does not beat BM25 on this one-shot benchmark, which is consistent with the dating caveat above.

## NOT-DONE

- The lane with lookalikes dated inside each fact's window (needed before any claim against BM25).
- A per-store cap or retention policy for shared servers at 365 days.
