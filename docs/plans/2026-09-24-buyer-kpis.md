# Buyer KPIs: showing a company what hippo changed

**Date:** 2026-09-24. **Status:** design. Nothing in this file has been measured yet.
**Roadmap:** Part X (CD7, CD11 to CD13), Part IX (TE5, EI12).

## The question a buyer asks

"We turned hippo on for 300 developers. What did it save us, and how do you know it was hippo?"

A believable answer needs three things:
1. **Numbers the buyer already trusts**, taken from their agent's own billing telemetry rather than from hippo's estimates.
2. **A comparison that rules out everything else changing.** Model prices, model versions, team mix and the kind of work all move month to month, so a before-and-after comparison on its own proves little.
3. **Hippo's own cost counted.** Hippo adds tokens to every prompt it helps, so only the net figure counts.

## What exists today

| Piece | What it measures | Gap for a buyer |
|---|---|---|
| TE0 token ledger (`hippo tokens`) | Tokens hippo itself sends to agents, per surface and session | Hippo's cost only, not the agent's total spend or any saving |
| TE4 session replay | Hippo's overhead on recorded sessions | Offline; no agent in the loop |
| TE5 A/B runner | Cost per resolved task with and without hippo, on task sequences in a lab | Lab tasks, not the buyer's work; no scored run yet |
| EI12 tenant replay | TE5 on the buyer's own history | Offline estimate before a pilot; still not live use |
| CD7 value report | Planned monthly report | Has no live comparison group to report against |

So hippo can prove its own cost today, and can estimate savings offline once TE5 and EI12 have run. **It cannot yet measure a saving in a company's live use.** That is the gap this design closes.

## KPIs

Four tiers, in the order a buyer cares about them. Every KPI is reported for hippo sessions and for holdout sessions (next section), never as one absolute number.

**Tier 1: money.** Source: the agent's telemetry, never hippo's estimate.
- **Cost per merged PR, and per session.** Cost-weighted tokens (uncached input, cache write, cache read, output) at list price, with hippo's own tokens included.
- **Tokens per session, by type.** Cache reads are about a tenth of the input price, so a raw token total misleads. Always cost-weight.
- **Turns and active time per session.** A secondary signal for "less wandering".

**Tier 2: what hippo is for.** Attributable to memory by construction.
- **Repeat-error rate.** The share of failed tool calls whose failure signature (`failureSignature`, `src/capture-error.ts`) was already seen in an earlier session. This is the most direct measure of "your agents stop repeating mistakes". It needs every signature logged, not only the ones stored.
- **Re-exploration.** File reads per session in areas the repository has been worked in before. TE8 targets this.
- **Corrections.** How often a developer restates a rule hippo already holds. This is hard to detect reliably, so it is exploratory only.

**Tier 3: guardrails.** Hippo must not make these worse.
- Revert rate and review-rejection rate of agent-authored PRs.
- CI failure rate on agent commits.
- Stale-memory incidents: a recalled memory later marked bad or superseded.

**Tier 4: hippo's cost.**
- Tokens hippo injected (TE0), hook latency, and store size.

**Not KPIs:**
- Lines of code, and suggestion acceptance rate.
- Developers' own estimates of time saved. In controlled studies, developers have believed they were faster when they were slower.

These can appear as context, never as proof.

## How to make the comparison causal

Three stages, each more credible than the last.

1. **Before the sale: an offline replay (EI12).** Replay the company's own history with memory on and off. The output is an estimated saving with a confidence interval, before anything is installed. It is still an estimate on past work.
2. **Pilot: a live holdout (CD11).**
   - A fixed share of sessions, for example 20%, run in shadow mode. Hippo still captures, but injects nothing into the prompt.
   - The split is by session id: random, and invisible to the developer.
   - Both arms run on the same days, the same models, the same people and the same work, so model price changes and seasonality cancel out.
   - The comparison is paired by developer, with a cluster bootstrap by developer (`clusteredPairedBootstrap` in `src/eval-stats.ts`).
   - Holdout sessions still feed the store, and developers carry what they learned between sessions. Both effects push the result towards no difference, so the estimate is conservative.
3. **Rollout: staggered by team.** Teams that turn hippo on later are the comparison group for teams that turned it on earlier (difference in differences). Use this when a holdout is not acceptable.

**Sample size (rough).** Assumptions, not data:
- the spread of per-session cost is large, with a standard deviation about twice the mean;
- the analysis uses log cost;
- the test is two-sided at 95% with 80% power.

On those assumptions, with a 20% holdout:
- a 10% difference needs about 1,400 holdout sessions, about 7,100 in total;
- a 20% difference needs about 320 holdout sessions, about 1,600 in total.

At 200 developers and three sessions a day, that is about 12 working days for the first and 3 for the second. Pairing by developer lowers these numbers. The pilot measures the real spread in its first week and recomputes the size before the report is due.

## What to build

- **CD11. Shadow holdout.**
  - A setting, `holdout.rate` with default 0, makes a deterministic share of sessions (hashed by session id) skip injection while capture continues.
  - Each such session is logged in the ledger as a holdout, so the report knows its arm.
  - The per-prompt hook, `hippo context` and the compaction resume respect it. MCP recall, which the agent asks for itself, returns a note that memory is held out.
- **CD12. Agent telemetry join.**
  - Import per-session cost from the agent's own telemetry: Claude Code's OpenTelemetry export or its usage API, keyed by session id, which hippo's ledger already records.
  - `hippo report --pilot` joins the two and computes tiers 1 to 4 per arm, with confidence intervals.
  - Copilot and Cursor expose less per-session data. Their reports fall back to tiers 2 to 4 plus organisation-level usage.
- **CD13. Failure-signature log.** Record every failure signature seen, with session and time, including skipped and duplicate ones, so repeat-error rate can be computed per arm.
- **CD7, upgraded.** The monthly value report becomes the pilot report: each KPI per arm, the difference with its interval, and hippo's own cost. It gives no saving figure until the interval excludes zero (non-goal 16).

## What to promise a buyer

**Promise the measurement, not a number.**

"Run hippo on 80% of sessions for four weeks. We report your cost per merged PR and your repeat-error rate with and without it, from your own telemetry, with confidence intervals. If there is no difference, the report says so."

The saving figure comes after TE5 and the first pilots.
