# VibeMemBench: plan to evaluate hippo

**Date:** 2026-09-24. **Status:** waiting on the benchmark's release. No hippo result exists.

## What VibeMemBench is

"VibeMemBench: Evaluating Memory Systems for Coding Agents on Real Repository Coding Tasks", arXiv 2609.23570 (September 2026; Liyang Fan, Yingcheng Shi, Yongbin Li, Chenghao Sun and others; Alibaba DAMO).

The arXiv page was blocked from this sandbox. The details below come from search excerpts and two public write-ups: jjakimoto/research-issues #1689 (summary) and #1670 (critique). Re-check them against the paper before quoting.

**Tasks and history**
- 111 coding targets from 90 SWE-rebench V2 repositories: bug fixes, features, interface changes and configuration work, in nine languages, mostly Python.
- 3,634 completed history trajectories from the same repositories, produced by a reference solver (deepseek-v4-flash with MiniSWEAgent).
- Distilled experience records hold a bug class, root cause, fix pattern and lesson. They never see the target's gold patch, test patch or test outcome.

**Conditions**
- Memory off.
- Frozen verified experience injected directly (a dose curve of 1 to 5 records).
- Four production memory systems that ingest the full prior history: Mem0, SimpleMem, MemoryOS and A-MEM. They extract records with deepseek-v4-flash, embed with Qwen3-Embedding-4B, and retrieve offline top-1.
- An irrelevant-memory control.

**Solvers:** five held-out models (deepseek-v4-pro, glm-5, glm-5.2, kimi-k2.7-code, qwen3.8-max), 4 seeds per condition, 444 target-seed runs per condition.

**Metrics**
- Resolved: executable tests pass.
- Steps per run.
- Solver-side tokens. Memory-side tokens, wall-clock time and API price are not recorded.
- 95% paired bootstrap CIs, 10,000 resamples at the target level.

**Results**
- Frozen verified experience lifts Resolved by 0.0 to 4.5 points, with every CI crossing or touching zero, and cuts steps for four of the five solvers.
- The four memory systems land at or below memory off in 11 of 12 pairings. Only MemoryOS with glm-5 is above it (+2.0). Mem0 with glm-5 is clearly below it (CI [-10.59, -0.45]).

**Critique (#1670):** the injection arm was filtered to targets where experience helped in a reference run, while the systems must find experience in all 3,634 raw trajectories. So part of the gap is built into the design. Two proposed fixes: an oracle-retrieval arm, and the filter switched off.

**Release status (checked 2026-09-24):**
- `AlibabaResearch/DAMO-ConvAI/VibeMemBench/README.md` says only "Coming". It was merged 2026-09-15 as PR #231.
- No dataset page was found.
- Nobody outside the authors can run it yet.

## How hippo will be evaluated when it is released

The protocol is fixed now, before seeing the data, so the result cannot be tuned to the benchmark.

1. **Use their harness unchanged:** targets, solvers (or the subset hippo can afford, named in advance), seeds, predicate and statistics. Hippo enters as a fifth memory system through whatever adapter interface the release defines.
2. **Arm hippo-matched.** Ingest the same 3,634 trajectories. Use each trajectory's final outcome as hippo's outcome signal, since that is hippo's mechanism. Retrieve top-1 under the benchmark's retrieval contract. This is the like-for-like comparison with Mem0, SimpleMem, MemoryOS and A-MEM.
3. **Arm hippo-native.** Hippo's own budgeted context (`hippo context`), with the budget declared before the run. Report it separately. It is not comparable to the top-1 arms, and it must not be reported as if it were.
4. **Configuration**, fixed before the run:
   - the half-life and physics defaults decided after the 1.45.0 mechanism audit (ROADMAP Part X, evidence check);
   - LLM extraction either off, or on with the benchmark's extraction model, stated either way.
5. **Controls:** memory-off and irrelevant-memory from the benchmark. Add hippo with outcome feedback off. That tests the one mechanism the audit found clearly helpful (trap suppression).
6. **Cost:** record hippo's own token use from the TE0 ledger. The benchmark does not record memory-side cost.
7. **Publication:** publish whatever the result is, with the configuration and raw runs. A result at or below memory off gets published too (non-goal 16; the RETRACTION discipline).

## What we expect, stated before running

The benchmark's base rate is harsh: 11 of 12 system pairings did not beat memory off. Hippo's own audit found its 7-day default losing to plain BM25 on current facts. The honest prior is that hippo-matched does not beat memory off either.

The best case is the setting where hippo differs from the other systems: repeated failure patterns, where outcome-marked lessons suppress what failed before. Treat it as a hypothesis, not a claim.

## What to do before the release

- **Run TE5** (`scripts/token-eval/ab-run.mjs`) on a few SWE-rebench V2 repositories hippo can reach.
  - It has the same shape: memory on and off, executable tests, and an irrelevant-memory control (TE5's `stale-memory` arm).
  - It uses Claude Code as the solver instead of their five models.
  - That gives an early read and exercises the hippo side of the adapter.
- **Build trajectory ingestion:** turn an agent trajectory into hippo memories with provenance, keeping the outcome and never seeing the gold patch. The benchmark and TE5 both need it.
- **Watch** `AlibabaResearch/DAMO-ConvAI/VibeMemBench` for the release.
