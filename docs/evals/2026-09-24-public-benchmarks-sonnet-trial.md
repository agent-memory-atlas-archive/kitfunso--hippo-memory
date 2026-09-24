# LoCoMo trial with Sonnet: hippo against BM25 (2026-09-24)

**Registration:** `2026-09-24-public-benchmarks-prereg.md`, Amendment 1, committed at `0502934` before any answer was generated. **Raw data:** `benchmarks/public/results/2026-09-24-sonnet-trial/`, which holds every answer, every verdict with its judge id, the sample and the scripts.

**Not comparable with Mem0's published numbers.** Claude Sonnet answered and judged, and only 10 memories reached the answering model. Mem0's files record gpt-5 at 200 memories. This trial answers one question: with an AI answering from the memories, does hippo as shipped do better than plain BM25 search?

## Setup

- **Data:** LoCoMo, 400 questions drawn with seed 1 and stratified by category: 219 single-hop, 73 multi-hop, 83 temporal and 25 open-domain.
- **Retrieval:** Mem0's runner (`mem0ai/memory-benchmarks` at `4b61c5d`, unchanged) against `benchmarks/public/hippo-mem0-server.mjs`.
  - `hippo`: shipped ranking with the 7-day half-life, no embeddings installed.
  - `bm25`: BM25 alone over the same stored turns.
- **Prompts:** Mem0's own answer and judge prompts (`benchmarks/locomo/prompts.py`), with the top 10 memories.
- **Answering:** 20 Sonnet subagents with 40 questions each. Hippo batch i and BM25 batch i held the same questions.
- **Judging:** 10 Sonnet subagents with 80 items each. Both arms were shuffled together (seed 7) with no arm label.
- **Second score:** the LoCoMo authors' token F1 (`snap-research/locomo`, `task_eval/evaluation.py`), which uses no model.

## Result

Paired by question, with a bootstrap 95% interval (4,000 draws).

| Score | hippo | bm25 | hippo minus bm25 [95% CI] |
|---|---|---|---|
| Judge accuracy (Mem0's judge prompt) | 62.7% | 68.8% | **-6.0 [-10.2, -1.5]** |
| Authors' F1 | 30.8 | 33.9 | **-3.1 [-5.8, -0.3]** |

By category, judge accuracy:
- **single-hop** (n=219): -9.6 [-15.5, -4.1];
- **multi-hop** (73): 0.0 [-11.0, +11.0];
- **temporal** (83): +1.2 [-8.4, +10.8];
- **open-domain** (25): -16.0 [-36.0, 0.0].

The full table is in `scores.txt`.

**Hippo as shipped answers worse than plain BM25, by 6 points, on both scores.** This is the retrieval gap in `2026-09-24-public-benchmarks-dryrun.md` carried through to answers: the evidence was retrieved 6.9 points less often at top 10. That gap came from the 7-day half-life, and with decay off hippo matched BM25. This trial did not run a decay-off arm, so this file does not claim that decay-off would match BM25 on answers.

## Deviations and limits

- **One answering batch was repaired.** Hippo batch 8 answered question `conv3_q92` twice and skipped `conv3_q8` and `conv4_q21`. The duplicate was dropped, and those three questions were answered by a fresh Sonnet agent. Their BM25 counterparts were answered inside their original batch.
- **Batching is not the runner's one-call-per-question.** Answering agents saw 40 prompts in one context, and judges saw 80. The symmetric batches and blind judging mean any carry-over affects both arms alike, but absolute accuracies may differ from per-call runs.
- **Hippo ran without embeddings.** The embeddings were not installed in the sandbox.
- **F1 runs low for both arms** because Sonnet's answers are longer than LoCoMo's short gold answers. F1 penalises extra words, and Mem0's judge prompt does not.
- **Single run.** No repeat seeds for answering or judging.

## What follows

1. **The 7-day default is the cause to fix first.** The decay confirmation (`2026-09-24-decay-default-prereg-2.md`) decides whether it moves to 365 days.
2. **Re-run this trial after that decision,** with a decay-off or 365-day arm added, before the registered gpt-5 run on the founder's machine.
3. **Do not publish a hippo LoCoMo score on the shipped default.** It trails plain BM25.
