# Token-efficiency evals (ROADMAP Part IX, Track TE)

Three harnesses, from cheapest to most convincing. Build first with `npm run build`.

| Harness | Roadmap | Needs | What it answers |
|---|---|---|---|
| `scripts/token-eval/replay.mjs` | TE4 | nothing (no LLM) | What does hippo's per-prompt hook add to a session, and how much does skipping unchanged blocks save? |
| `scripts/token-eval/budget-curve.mjs` | TE3 | a LongMemEval-format JSON | How many tokens of memory does an agent need to see the evidence, with hippo against recency, full context and no memory? |
| `scripts/token-eval/ab-analyze.mjs` | TE5 | run records from an agent A/B | Cost per resolved task, resolve rate and work avoided, with bootstrap CIs. Protocol: `docs/evals/2026-09-23-te5-token-ab-preregistration.md` |

Shared statistics and four-bucket cost accounting are in `src/eval-stats.ts`.

## What is and is not established

- **Established, with records:** on the bundled synthetic traces, skipping unchanged hook blocks cuts the text hippo itself injects by 85-90%. The run is deterministic: two runs give identical per-prompt counts, and the record is `replay-results.json`.
- **Not established:** that hippo saves anyone tokens or money. The replay prices only hippo's own text (tens of tokens per prompt in these traces), and its token counts are an estimate (characters / 4). For comparison, one long Claude Code session in the container this was built in recorded about 207 million cache-read tokens, as counted by the API. Cutting hippo's overhead is housekeeping. A saving claim needs the paired A/B (TE5) on real tasks.
- **Needs checking on a real machine:** that Claude Code keeps hook `additionalContext` in the transcript, which the cache model assumes. `claude-usage.mjs` below reads the real records.

## Measure on your own machine

Claude Code writes every session to `~/.claude/projects/<project>/<session>.jsonl`, including the API's billed usage for every message. The TE0 ledger records hippo's session id from the hook payload, and that id is the transcript file name.

```bash
npm run build
node scripts/token-eval/claude-usage.mjs --days 30                 # all sessions, joined to ~/.hippo's ledger
node scripts/token-eval/claude-usage.mjs --hippo-root path/to/project/.hippo --prices prices.json --out usage.json
```

It reports, per session:
- uncached input, cache writes, cache reads and output, as billed;
- the same totals priced in dollars, if you give prices;
- how many tokens hippo sent and skipped;
- hippo's share of the new context written.

Usage is counted once per API message id. One message spans several transcript lines, so summing lines would roughly double the totals. Subagent transcripts count towards their parent session.

This measures cost and hippo's share of it. It does not measure savings, because a session without hippo is a different session. A before-and-after comparison across weeks is confounded by different work, so the saving claim still needs TE5.

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
