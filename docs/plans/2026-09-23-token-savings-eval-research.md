# Token savings: how to measure them honestly, and what to build

Date: 2026-09-23. Status: research, feeds ROADMAP Part IX (Track TE). No code changes.

Update, same day: the first slices of TE0 (token ledger, `hippo tokens`), TE1 (stable hook
rendering) and TE2 (skip unchanged hook blocks) shipped in PR #227, along with the MCP budget
description fix. Section 1 describes the code before that change.

Corrections after an independent review (2026-09-24): the "input outnumbers output more than 150 to 1" and "76% of tokens on reads" figures attributed to arXiv 2604.22750 did not appear in any excerpt checked, so treat them as unverified (the paper's verified findings are about 1000x the tokens of single-turn reasoning, input-driven cost, and up to 30x run-to-run variance). The 40-turn upper bound's cache reads come to about 1,170k token-reads, about 117k uncached-equivalent rather than 123k; the roughly 200k total stands.

Method: two parallel passes. The first was a read-only audit of how hippo counts, spends and
reports tokens at v1.44.0 plus PR #227. The second was a literature and industry review of how
memory systems and coding-agent benchmarks measure token and cost savings. arxiv.org and
several vendor docs were blocked by the sandbox proxy, so paper figures were checked through
abstracts, the authors' GitHub or Hugging Face pages, and secondary write-ups. Figures marked
*unverified* could not be confirmed that way. Items from 2026 are preprints. Re-check any
figure at its source before it goes on a slide.

## Bottom line

1. **Hippo cannot prove it saves tokens today, because it never records what it spends.**
   It estimates tokens as characters divided by 4 (`src/search.ts:108`), prints the count,
   and stores nothing. No audit row, recall trace or status field carries a token number.
   Only the lifecycle stress eval reports tokens, and its headline was NULL.
2. **Hippo also costs tokens, and that cost has never been measured.** The Claude Code
   `UserPromptSubmit` hook runs
   `hippo context --pinned-only --include-recent 5 --format additional-context`
   (`src/hooks.ts:133`) on every prompt, with a 1,500-token cap (`pinnedInject.budget`,
   `src/config.ts`). Nothing checks whether the block changed since the last turn, so the
   same text can be injected on every turn and stays in the conversation history.
3. **The injected text is not cache-stable.** `printContextMarkdown` (`src/cli.ts:6740`)
   renders a live strength percentage and dates on every line. Two injections of the same
   memories can therefore differ by a few bytes, and prompt caches match exact prefixes.
4. **The literature supports the claim hippo wants to make, but only in a narrower form.**
   Memory systems routinely report 85-99% fewer context tokens than full-history
   baselines. The accuracy results are mixed: Mem0's own table has full context scoring
   *higher* than Mem0 on LoCoMo. The defensible claim is "about the same answers for a
   fraction of the tokens" until a paired agent eval shows higher resolve rates too.
5. **For coding agents, the saving is not in the memory block. It is in what the agent
   no longer has to do.** Input tokens outnumber output tokens by more than 150 to 1, and
   most input goes on reading files. A lesson that stops one wrong turn or one re-read of
   a large file is worth far more than trimming the memory block. The eval has to measure
   the whole task, not the injection.
6. **Measure dollars across four token buckets, not raw tokens.** Uncached input, cache
   write, cache read and output are priced very differently. A cache read costs about
   0.1x the input price and a cache write 1.25x on Anthropic, so a raw-token metric can
   show a saving where the bill went up.

## 1. What hippo does with tokens today (source-verified)

### Counting and budgets

| Surface | Default budget | Where |
|---|---|---|
| `hippo recall`, `hippo explain` | 4000 | `src/cli.ts:1024`, `src/cli.ts:2194` |
| `hippo context` | 1500 | `src/cli.ts:6573` |
| `assemble` | 4000 | `src/api.ts:1329` |
| MCP `hippo_recall` | 4000 (`config.defaultBudget`) | `src/mcp/server.ts:530`; the tool description says 1500 |
| MCP `hippo_context` | 3000 (`config.defaultContextBudget`) | `src/mcp/server.ts:1069`; the tool description says 1500 |
| Pinned inject per prompt | 1500 | `pinnedInject.budget` in `src/config.ts` |

- **Token counts are an estimate.** `estimateTokens` is `ceil(chars / 4)`. The same rule
  is written out again in five places in `src/api.ts` and once in `src/cli.ts`. Code,
  JSON and non-English text tokenize worse than English prose, so the estimate runs low
  exactly where coding agents spend most.
- **Packing is greedy.** Results are ranked, then deduplicated and diversified (MMR),
  then packed: an item that does not fit is skipped, and at least `minResults` items are
  always kept. **The budget is a ceiling that recall tries to fill.** Nothing stops early
  when the remaining results are weak.
- **Some context sits outside the budget.** The active snapshot, the handoff and recent
  events are rendered alongside the memories. Recall reports their size separately as
  `continuityTokens`; `hippo context` does not add them to the budget.

### What is recorded

Nothing about tokens. `audit_log` recall rows store a query hash, the query length and the
result count. `recall_traces` store ranks and scores. `hippo status` counts memories. The UI
has no token view. ROADMAP A7 (per-tenant cost and usage rollups) is still pending.

### Evals

| Harness | Reports tokens? | Note |
|---|---|---|
| LongMemEval, LoCoMo | Budget fixed at 4000, not measured | Retrieval recall only. 98.6% R@5 is per-haystack and saturated. |
| Lifecycle stress (`scripts/lifecycle-stress/run.mjs`) | Yes, per condition | Every condition fills the same ~1,490-token budget. Headline NULL (Part III). |
| DAG slice 1 | Token reduction at fixed accuracy | MEASURED-FALSE: substitution cost 6.3pp QA. |
| Sequential learning | No | Magnitude retracted in v1.7.9. |
| `hippo eval`, micro, e-series, a1 | No | Retrieval quality or latency only. |

So hippo has a fixed-budget retrieval ruler and no ruler for **task cost**. Every token
claim in the repository (A9 "5x compute cost reduction", Track L "5x-cost lever") is
unmeasured.

### Where hippo itself spends tokens

The per-prompt pinned inject is the largest one. In a host that keeps
`additionalContext` in the transcript, as Claude Code does (verify in TE0), a block of
*k* tokens injected on each of *n* turns adds *k·n* tokens to the history, and each later
turn re-reads everything before it.

As an upper bound, at the 1,500 cap over a 40-turn session:
- 60,000 tokens are written once (at 1.25x): about 75,000 uncached-equivalent;
- about 1.2 million token-reads come from the cache (at 0.1x): about 123,000
  uncached-equivalent.

That is roughly **200,000 uncached-equivalent tokens per session** from the hook alone.
Real blocks are usually smaller than the cap, which is why TE0 measures them first. If
most turns re-inject an unchanged block, most of this cost can be removed with no loss
(TE2).

## 2. How the field measures token savings

### Memory-system papers

Every one of these compares against a **full-context** baseline, which puts the whole
history in the prompt, and reports context tokens per query alongside accuracy and latency.

| System | Token result | Accuracy result |
|---|---|---|
| Mem0 (arXiv 2504.19413) | ~1.8k vs ~26k tokens per query (>90% fewer); p95 latency 1.44s vs 17.12s | Full context 72.9 J, the highest; Mem0 about 67-68 (*partly unverified*) |
| Zep (arXiv 2501.13956) | 1.6k vs 115k tokens on LongMemEval; 2.58s vs 28.9s | 71.2% vs 60.2% (gpt-4o) |
| LightMem (arXiv 2510.18866) | Up to 117x fewer tokens, 159x fewer API calls | Up to +10.9% |
| A-Mem (arXiv 2502.12110) | 1.2-2.5k vs 16.9k tokens per memory operation | Multi-hop ROUGE-L 44.3 vs 18.1 |

**Lesson from the Mem0 vs Zep dispute.** Each vendor ran the other's system and got a
worse number. Zep's own rebuttal then contained an arithmetic error that had to be
corrected in public. A token claim that a competitor can re-run and dispute is worth less
than none. **Publish the harness, every baseline's configuration and the error bars.**

### Coding-agent benchmarks

- **Cost per task.** SWE-bench reports $ per instance, as do SWE-agent (a $4 cap),
  mini-SWE-agent, the OpenHands Index and the Aider leaderboard's cost column.
- **Terminal-Bench.** The Artificial Analysis leaderboard splits cost per task into
  input, cache hit, cache write, reasoning and answer tokens. **This is the accounting
  hippo should copy.**
- **"How Do AI Agents Spend Your Money?"** (arXiv 2604.22750, 2026):
  - agentic coding uses over 1000x the tokens of single-turn reasoning;
  - input outnumbers output more than 150 to 1;
  - one model spent 76% of its tokens on reads;
  - token use varies widely between runs of the same task, so a single run proves nothing.
- **Experience reuse measured on later tasks:**
  - Agent Workflow Memory (arXiv 2409.07429): +24.6% and +51.1% relative success, with
    fewer steps;
  - ReasoningBank (arXiv 2509.25140): stores lessons from failures as well as successes;
    up to 34% relative gain and 16% fewer steps;
  - Agent KB (arXiv 2507.06229): OpenHands on SWE-bench, 24.3% to 28.3%.
- **SWE-ContextBench** (arXiv 2602.08316) is the closest existing benchmark to hippo's
  claim. It pairs base tasks with related later tasks. Correctly retrieved, summarized
  prior experience raises accuracy and cuts runtime and token cost. **Unfiltered or
  wrongly selected experience helps little or hurts.**

### Why fewer tokens can be smarter

- **Lost in the Middle** (arXiv 2307.03172): with the answer in the middle of a long
  context, GPT-3.5 scored below its own closed-book score.
- **Context Rot** (Chroma, 2025): all 18 models tested did better on a focused
  ~300-token LongMemEval prompt than on the full ~113k-token one.
- **RULER** (arXiv 2404.06654) and **NoLiMa** (arXiv 2502.05167): claimed context lengths
  overstate usable ones. With low word overlap, 11 models fall below half their
  short-context score at 32k.

This is the scientific basis for hippo's pitch. It still has to be shown on hippo, because
SWE-ContextBench shows the opposite result when retrieval picks the wrong memories.

### Prompt caching changes the arithmetic

- **Anthropic:**
  - cache read 0.1x the input price; cache write 1.25x (5-minute TTL) or 2x (1-hour TTL);
  - caching is an exact prefix match in the order tools, system, messages;
  - a changed byte invalidates everything after it;
  - usage reports `cache_creation_input_tokens` and `cache_read_input_tokens`.
- **OpenAI:** automatic caching above 1,024 tokens; usage reports `cached_tokens`. Recent
  pricing puts cached input at about 90% off (*secondary*).

Consequences for hippo:
- A memory block that changes per query and sits early in the prompt (system prompt,
  CLAUDE.md area) forces every later turn to re-pay full price for the whole history.
  That can cost more than the memory saves.
- Hippo's hook injects at the user-turn position, which does not invalidate earlier
  history. But the block is re-sent every turn, and its volatile strength and date fields
  guarantee that two copies rarely match byte for byte.
- An eval that ignores caching will overstate savings. Most coding-agent input is already
  cache reads at 0.1x, so a 10% cut in raw tokens can be a 1-2% cut in dollars.

### Eval design practice

- **Paired A/B.** Run the same tasks with and without hippo, with the same model version,
  harness and seeds. Analyse per-task paired differences, and cluster standard errors by
  repository ("Adding Error Bars to Evals", arXiv 2411.00640).
- **Repeated runs.**
  - Use at least 3-5 runs per task, because agent token use is highly variable.
  - Report pass@1, and pass^k for consistency (Anthropic, "Demystifying evals for AI
    agents", 2026).
  - Use bootstrap CIs for ratio metrics such as dollars per resolved task.
- **Cost-controlled reporting.**
  - Plot accuracy against dollars and report the Pareto frontier ("AI Agents That
    Matter", arXiv 2407.01502).
  - Report dollars per resolved task, not dollars per attempt.
- **Controls that isolate the mechanism:**
  - the same token budget filled with random repository text (is the gain from hippo's
    selection, or just from more context?);
  - stale or irrelevant memories injected (does bad memory hurt?);
  - a dump of all memories (is selection doing anything?).
- **Contamination.**
  - SWE-bench issues leak into training data ("The SWE-Bench Illusion", arXiv 2506.12286).
  - Use fresh or private repositories, including hippo's own history.
  - Never let a memory contain a gold patch or test answer.
  - Keep the memory stores of learning tasks and test tasks separate.
- **Execution-based grading first.** Tests pass or fail. Use an LLM judge only where there
  is no executable check, blind it to the condition, and calibrate it against human labels.
- **Comparison baselines.**
  - LLMLingua-2 prompt compression (arXiv 2403.12968; 3-6x faster than LLMLingua).
  - Naive top-k RAG over the same store.
  - Self-Route (arXiv 2407.16833), which routes between RAG and long context and cuts
    cost 39-65% at comparable accuracy.
  - If hippo cannot beat naive top-k at the same budget, the lifecycle is not paying for
    itself.

## 3. The metric set

One headline and four supporting metrics, all paired against a no-memory arm with 95%
bootstrap CIs.

| Metric | Definition | Why |
|---|---|---|
| **$ per resolved task** (headline) | List-price dollars over the four buckets (uncached input, cache write, cache read, output), divided by tasks resolved | What a buyer pays; cannot be gamed by trading tokens between buckets |
| Resolve rate delta | Paired pass@1 difference; pass^k for consistency | The "smarter" claim; stays a claim only when the CI excludes zero |
| Work avoided | Turns, file reads, tool calls, and repeated-error rate per task | The mechanism: fewer wrong turns and re-reads |
| Token ROI | (Dollars saved downstream) / (dollars hippo adds: injection, retrieval, sleep, any cache break) | Net, not gross; a negative ROI means the memory block costs more than it saves |
| Injection overhead | Tokens injected per session, share re-injected unchanged, cache hit rate of hippo's own text | The cost side; cheap to measure and to fix |

The retrieval-level curve is a supporting chart, not a claim. It shows answer recall
against injected tokens at budgets 250, 500, 1k, 2k, 4k and 8k, plus the **minimum tokens
to answer** (the smallest budget that includes the gold evidence). It is cheap and
deterministic, so it can gate CI. It does not show task savings.

## 4. The eval ladder

Each rung is cheaper and less convincing than the next. Build them in order and publish
only what the rung above confirms.

1. **Ledger (TE0).** Instrument hippo to record every injection: surface, estimated and
   (optionally) exact tokens, number of items, and a hash of the rendered block. This is
   also the product feature a buyer asks for ("show me what it costs").
2. **Offline token-at-accuracy curve (TE3).** LongMemEval and LoCoMo at a sweep of
   budgets. Compare hippo against full context, naive top-k, LLMLingua-2 compression and
   no memory. Deterministic and runs in CI. Fixes the saturation problem by reporting
   tokens-to-answer instead of recall at a fixed budget.
3. **Session replay (TE4).** Replay recorded agent sessions (hippo's own dogfood,
   anonymized) through the hooks. Count injected tokens, unchanged re-injections and
   byte-stability, and price them with a cache model. No LLM calls, so it can gate CI. It
   catches regressions like a hook that doubles its output.
4. **Paired agent A/B on task sequences (TE5).** The real test. Build a sequence of related
   coding tasks: earlier tasks produce lessons, later tasks can use them. Use
   SWE-ContextBench, and fresh issues from hippo's own history and other post-cutoff
   public repositories. Run six arms on the same model and harness:

   | Arm | What it tests |
   |---|---|
   | No memory | Baseline |
   | Hippo (default hooks) | The product as shipped |
   | All memories dumped | Is selection doing anything? |
   | Naive top-k at the same budget | Is the lifecycle doing anything? |
   | Random repository text at the same budget | Is the gain just extra tokens? |
   | Stale or irrelevant memories | Does bad memory hurt? |

   Use 3-5 seeds and cluster by repository. Log the four buckets from provider usage
   fields. Pre-register the thresholds in `docs/evals` before the first run.
5. **Tenant replay (EI12).** The same A/B on a design partner's own history. This produces
   the number for a sales conversation.

## 5. Token-saving measures to build (each ships only with a TE eval delta)

Ordered by expected value per unit of effort. The first three remove cost hippo adds
itself, so they carry little risk to answer quality.

1. **Inject only when it changed (TE2).**
   - Hash the rendered pinned block per session.
   - If it matches the last injection, inject nothing, or a one-line
     "memory unchanged since turn N" marker.
   - Inject only new or changed items since the last turn.
   - Expected effect: most of the per-session hook cost in section 1 goes.
2. **Cache-stable rendering (TE1).**
   - Remove per-call volatile text from injected blocks: bucket the strength percentage
     or drop it, and use stable dates.
   - Sort ties by id so the same memories always render byte-identically.
   - Pinned memories go at session start, where they can join the cached prefix, not on
     every turn.
3. **Real token counting and honest defaults (TE0).**
   - One `estimateTokens` used everywhere, with an optional exact tokenizer or a
     per-model calibration factor.
   - Fix the MCP tool descriptions that advertise 1,500 while the code uses 4,000 and
     3,000.
   - Count continuity blocks inside the budget.
4. **Adaptive budget (TE6).**
   - Stop packing when relevance falls off (a score-gap or threshold cutoff), rather than
     filling the budget.
   - Inject nothing when nothing is relevant.
   - The budget becomes a ceiling, not a target. Accuracy must hold on TE3 and TE5.
5. **Terse rendering (TE7).** A compact format for agent-facing output that drops
   markdown decoration and repeated labels, measured as tokens per fact at equal
   accuracy.
6. **Lessons that prevent exploration (TE8, research).** File maps, "where X lives",
   commands that work and known dead ends, captured from sessions that read many files.
   This is the lever for the 76% of tokens spent on reads. It needs TE5 to prove it,
   because wrong pointers cost more than none.
7. **Consolidation that actually compresses (TE9, research).** Part III found merge
   summaries are concatenations, and DAG slice 1 lost 6.3pp. Any new attempt starts from
   a new hypothesis and must win on TE3 and TE5.

## 6. What we can say now, and what we cannot

- **Can say:**
  - Hippo injects a bounded slice (1.5k-4k tokens by default) instead of a transcript.
  - The research literature shows focused context beats long context, and memory
    systems like Mem0 and Zep report over 90% fewer context tokens than full history.
- **Cannot say yet:**
  - Hippo saves an organization any given percentage of tokens or dollars.
  - Hippo makes agents resolve more tasks.
  - Either claim needs TE5, and the "5x cost reduction" line in A9 should not be quoted
    until then.
- **Must admit if asked:** hippo's own per-prompt hook adds tokens every turn today, and
  it has not been measured. TE0 to TE2 fix that first.

## References

- Chhikara et al. Mem0. arXiv 2504.19413, 2025.
- Rasmussen et al. Zep. arXiv 2501.13956, 2025. Rebuttal: blog.getzep.com, "Lies, Damn Lies & Statistics"; correction in getzep/zep-papers issue 5.
- Fang et al. LightMem. arXiv 2510.18866, ICLR 2026.
- Xu et al. A-Mem. arXiv 2502.12110, 2025.
- Wu et al. LongMemEval. arXiv 2410.10813, ICLR 2025.
- Maharana et al. LoCoMo. arXiv 2402.17753, ACL 2024.
- Hu et al. MemoryAgentBench. arXiv 2507.05257, ICLR 2026.
- Letta. Context-Bench. letta.com/blog/context-bench.
- "How Do AI Agents Spend Your Money?" arXiv 2604.22750, 2026.
- Wang et al. Agent Workflow Memory. arXiv 2409.07429, 2024.
- ReasoningBank. arXiv 2509.25140, 2025.
- Agent KB. arXiv 2507.06229, 2025.
- SWE-ContextBench. arXiv 2602.08316, 2026.
- Liu et al. Lost in the Middle. arXiv 2307.03172, TACL 2024.
- Hong, Troynikov, Huber. Context Rot. Chroma, 2025.
- Hsieh et al. RULER. arXiv 2404.06654, 2024.
- Modarressi et al. NoLiMa. arXiv 2502.05167, ICML 2025.
- Anthropic prompt caching documentation; OpenAI "Prompt Caching in the API".
- Miller. Adding Error Bars to Evals. arXiv 2411.00640, 2024.
- Anthropic. Demystifying evals for AI agents. 2026.
- Kapoor et al. AI Agents That Matter. arXiv 2407.01502, 2024.
- The SWE-Bench Illusion. arXiv 2506.12286, 2025.
- LLMLingua-2. arXiv 2403.12968, 2024.
- Li et al. Self-Route. arXiv 2407.16833, EMNLP 2024.
