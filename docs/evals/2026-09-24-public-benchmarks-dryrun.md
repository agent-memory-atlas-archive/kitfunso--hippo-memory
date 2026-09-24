# Public benchmarks: dry run and a free retrieval check (2026-09-24)

**Plan:** `2026-09-24-public-benchmarks-prereg.md`. Nothing here is a registered result. This file checks that the setup works, and records one undeclared retrieval diagnostic that needs no API spend.

## Setup check

Mem0's runner (`mem0ai/memory-benchmarks` at `4b61c5d`, unchanged) ran against `benchmarks/public/hippo-mem0-server.mjs` in `--predict-only` mode on all 10 LoCoMo conversations. That covers categories 1 to 4: 1,540 questions, 1,531 with evidence turns found in the dataset. Ingestion and search completed for every arm, with no errors.

## Diagnostic: is the answer's evidence retrieved? (undeclared, retrieval only)

`benchmarks/public/evidence_recall.py` measures the share of each question's gold evidence turns found in the top k retrieved memories. The intervals are paired bootstraps over questions (2,000 draws).

Arms:
- **hippo:** as shipped, with the 7-day half-life;
- **no-decay:** the same arm with `HIPPO_ABLATE_DECAY=1`;
- **bm25:** BM25 alone.

No arm had local embeddings: they were not installed in the sandbox.

| k | hippo | no-decay | bm25 | hippo minus bm25 [95% CI] | no-decay minus bm25 [95% CI] |
|---|---|---|---|---|---|
| 10 | 46.2 | 52.8 | 53.1 | -6.9 [-8.5, -5.5] | -0.3 [-0.9, +0.4] |
| 50 | 67.3 | 68.7 | 69.4 | -2.1 [-3.0, -1.3] | -0.7 [-1.2, -0.2] |
| 200 | 82.1 | 82.2 | 82.3 | about 0 | about 0 |

**What it shows:**
- Shipped hippo retrieves the evidence less often than plain BM25 at small budgets.
- The whole gap comes from the 7-day decay: with decay off, hippo matches BM25.
- At 200 memories, the budget Mem0's headline numbers use, every arm retrieves the same evidence, so an answer-accuracy run at top 200 will barely separate them.

This matches the E1 audit and the decay result (`2026-09-24-decay-default-result.md`), on an independent public dataset. It is one more reason the decay default matters before any paid run.

**Limits:**
- Retrieval only: no answers were generated or judged.
- Hippo's hybrid ranking ran without embeddings.
- LoCoMo's dates span months, so decay acts on it, unlike a same-day store.
- Mem0's own memories are extracted facts, not raw turns, so this check cannot score mem0-oss.
