# Token-efficiency evals (ROADMAP Part IX, Track TE)

Three harnesses, from cheapest to most convincing. Build first with `npm run build`.

| Harness | Roadmap | Needs | What it answers |
|---|---|---|---|
| `scripts/token-eval/replay.mjs` | TE4 | nothing (no LLM) | What does hippo's per-prompt hook add to a session, and how much does skipping unchanged blocks save? |
| `scripts/token-eval/budget-curve.mjs` | TE3 | a LongMemEval-format JSON | How many tokens of memory does an agent need to see the evidence, with hippo against recency, full context and no memory? |
| `scripts/token-eval/ab-analyze.mjs` | TE5 | run records from an agent A/B | Cost per resolved task, resolve rate and work avoided, with bootstrap CIs. Protocol: `docs/evals/2026-09-23-te5-token-ab-preregistration.md` |

Shared statistics and four-bucket cost accounting are in `src/eval-stats.ts`.

## Session replay (TE4)

```bash
node scripts/token-eval/replay.mjs            # bundled synthetic traces
node scripts/token-eval/replay.mjs --traces my-traces/ --out my-results.json
```

It replays each trace through the real hook in two arms:
- `every-turn`: the behaviour before TE2;
- `skip-unchanged`: the default.

It prices only hippo's injected text: written to the cache once at 1.25x, then re-read at 0.1x on every later prompt until a compaction drops it. `tests/token-eval-replay.test.ts` runs a short trace in CI.

**Latest run, `replay-results.json`, on synthetic traces:**

| Trace | Prompts | Every-turn cost | Skip-unchanged cost | Saving |
|---|---|---|---|---|
| steady | 40 | 8,704 | 952 | 89.1% |
| learning (4 lessons) | 40 | 13,921 | 2,235 | 83.9% |
| long-compact (2 lessons, 1 compaction) | 80 | 24,040 | 2,943 | 87.8% |

- Costs are in uncached-equivalent tokens.
- An unchanged block rendered byte-identically in 100% of cases.
- The traces are synthetic, with three short pinned rules, so the absolute numbers are small. Real stores inject more per block, and the TE0 ledger (`hippo tokens`) measures what real sessions send.

## Token-at-accuracy curve (TE3)

```bash
node scripts/token-eval/budget-curve.mjs --data benchmarks/longmemeval/data/longmemeval_s_cleaned.json
```

- **Data:** download `longmemeval_s_cleaned.json` from the LongMemEval release into `benchmarks/longmemeval/data/`.
- **Default without data:** it runs on the bundled `synthetic_smoke.json`. Each of those haystacks is about 200 tokens, so every arm reaches the evidence at every budget. That run checks the mechanics and says nothing about hippo.
- **Tests:** `tests/token-eval-budget-curve.test.ts` checks the scoring on a haystack built so that recency and relevance disagree.
- **Deferred:** an LLMLingua-2 compression arm.

## A/B analysis (TE5)

```bash
node scripts/token-eval/ab-analyze.mjs --runs runs.jsonl --prices prices.json
```

- `runs.jsonl` holds one record per task, arm and seed; the input format is in the script header.
- `prices.json` holds `{inputPerMTok, cacheWritePerMTok, cacheReadPerMTok, outputPerMTok}`, taken from the provider's current price page for the exact model.
- No A/B has been run yet. The runner that drives an agent through task sequences is the next step. It needs an API key and a machine that can run the agent, so it is not part of this container's CI.
