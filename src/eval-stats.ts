/**
 * Statistics and cost accounting for the token-efficiency evals (ROADMAP
 * Part IX, TE3-TE5).
 *
 * - Cost: price provider usage over four buckets (uncached input, cache
 *   write, cache read, output). Raw token counts overstate savings when most
 *   input is already cache reads, so every dollar claim goes through here.
 * - Uncertainty: paired bootstrap over tasks, cluster bootstrap (tasks that
 *   share a repository are not independent), and a paired ratio bootstrap for
 *   dollars per resolved task.
 *
 * Deterministic: every resampling function takes a seed, so a published
 * result can be reproduced exactly.
 */

/** Token usage for one model call or one whole task, split by how it is billed. */
export interface Usage {
  /** Input tokens billed at the base input price (not read from or written to a cache). */
  inputTokens: number;
  /** Input tokens written to a prompt cache. */
  cacheWriteTokens: number;
  /** Input tokens read from a prompt cache. */
  cacheReadTokens: number;
  /** Output tokens, including any reasoning tokens the provider bills as output. */
  outputTokens: number;
}

/**
 * Prices in dollars per million tokens. Take them from the provider's
 * current price page for the exact model; this module has no built-in
 * prices because they change.
 */
export interface Prices {
  inputPerMTok: number;
  cacheWritePerMTok: number;
  cacheReadPerMTok: number;
  outputPerMTok: number;
}

/** Sum several usages bucket by bucket. */
export function addUsage(...usages: Usage[]): Usage {
  const total: Usage = { inputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 0, outputTokens: 0 };
  for (const u of usages) {
    total.inputTokens += u.inputTokens;
    total.cacheWriteTokens += u.cacheWriteTokens;
    total.cacheReadTokens += u.cacheReadTokens;
    total.outputTokens += u.outputTokens;
  }
  return total;
}

/** Dollar cost of `usage` at `prices`. */
export function priceUsage(usage: Usage, prices: Prices): number {
  return (
    usage.inputTokens * prices.inputPerMTok
    + usage.cacheWriteTokens * prices.cacheWritePerMTok
    + usage.cacheReadTokens * prices.cacheReadPerMTok
    + usage.outputTokens * prices.outputPerMTok
  ) / 1_000_000;
}

/**
 * Relative prices of the cache buckets against the base input price, for
 * cost in "uncached-equivalent tokens" when no dollar prices are given.
 * Defaults follow Anthropic's published ratios (5-minute cache write 1.25x,
 * cache read 0.1x); pass the ratios for another provider when needed.
 */
export interface CacheRatios {
  write: number;
  read: number;
}

/** Default cache price ratios (write 1.25x, read 0.1x of base input). */
export const DEFAULT_CACHE_RATIOS: Readonly<CacheRatios> = { write: 1.25, read: 0.1 };

/** Input cost of `usage` in uncached-equivalent tokens (output excluded). */
export function uncachedEquivalentInput(usage: Usage, ratios: CacheRatios = DEFAULT_CACHE_RATIOS): number {
  return usage.inputTokens + usage.cacheWriteTokens * ratios.write + usage.cacheReadTokens * ratios.read;
}

/**
 * Mulberry32: a small seeded PRNG returning floats in [0, 1). Same seed,
 * same stream, on every platform.
 */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A point estimate with a percentile bootstrap confidence interval. */
export interface Estimate {
  estimate: number;
  low: number;
  high: number;
  /** Resamples drawn. */
  iterations: number;
}

/** Options shared by the bootstrap functions. */
export interface BootstrapOpts {
  /** Resamples. Default 5000. */
  iterations?: number;
  /** Two-sided level, e.g. 0.05 for a 95% interval. Default 0.05. */
  alpha?: number;
  /** PRNG seed. Default 1. */
  seed?: number;
}

/** Lower and upper ends of a percentile interval. */
interface Interval {
  low: number;
  high: number;
}

function percentileInterval(samples: number[], alpha: number): Interval {
  const sorted = [...samples].sort((x, y) => x - y);
  const lowIdx = Math.max(0, Math.floor((alpha / 2) * sorted.length));
  const highIdx = Math.min(sorted.length - 1, Math.ceil((1 - alpha / 2) * sorted.length) - 1);
  return { low: sorted[lowIdx]!, high: sorted[highIdx]! };
}

function mean(xs: number[]): number {
  return xs.length === 0 ? 0 : xs.reduce((s, x) => s + x, 0) / xs.length;
}

/**
 * Paired bootstrap for the mean of per-task differences (treatment minus
 * control on the same task). An interval that excludes zero is the bar for
 * calling a difference real.
 */
export function pairedBootstrap(diffs: number[], opts: BootstrapOpts = {}): Estimate {
  const iterations = opts.iterations ?? 5000;
  const alpha = opts.alpha ?? 0.05;
  if (diffs.length === 0) return { estimate: 0, low: 0, high: 0, iterations: 0 };
  const rand = seededRandom(opts.seed ?? 1);
  const n = diffs.length;
  const samples: number[] = [];
  for (let b = 0; b < iterations; b++) {
    let s = 0;
    for (let i = 0; i < n; i++) s += diffs[Math.floor(rand() * n)]!;
    samples.push(s / n);
  }
  return { estimate: mean(diffs), ...percentileInterval(samples, alpha), iterations };
}

/**
 * Cluster bootstrap for the mean of per-task differences: resamples whole
 * clusters (for example all tasks from one repository), because tasks in a
 * cluster share causes and are not independent draws.
 */
export function clusteredPairedBootstrap(
  diffsByCluster: ReadonlyMap<string, number[]>,
  opts: BootstrapOpts = {},
): Estimate {
  const iterations = opts.iterations ?? 5000;
  const alpha = opts.alpha ?? 0.05;
  const clusters = [...diffsByCluster.values()].filter((c) => c.length > 0);
  const all = clusters.flat();
  if (all.length === 0) return { estimate: 0, low: 0, high: 0, iterations: 0 };
  const rand = seededRandom(opts.seed ?? 1);
  const k = clusters.length;
  const samples: number[] = [];
  for (let b = 0; b < iterations; b++) {
    let sum = 0;
    let count = 0;
    for (let i = 0; i < k; i++) {
      const c = clusters[Math.floor(rand() * k)]!;
      for (const d of c) sum += d;
      count += c.length;
    }
    samples.push(count === 0 ? 0 : sum / count);
  }
  return { estimate: mean(all), ...percentileInterval(samples, alpha), iterations };
}

/** One task's outcome in one arm, for {@link costPerResolvedDelta}. */
export interface ArmOutcome {
  /** Dollars (or uncached-equivalent tokens) spent on the task. */
  cost: number;
  /** Whether the task was resolved. */
  resolved: boolean;
}

/** Result of {@link costPerResolvedDelta}. */
export interface CostPerResolvedDelta {
  control: number;
  treatment: number;
  /** treatment minus control, with its interval. */
  delta: Estimate;
  /** (treatment minus control) / control, with its interval. Negative is a saving. */
  relative: Estimate;
}

function costPerResolved(outcomes: ArmOutcome[]): number {
  const resolved = outcomes.filter((o) => o.resolved).length;
  const cost = outcomes.reduce((s, o) => s + o.cost, 0);
  return resolved === 0 ? Number.POSITIVE_INFINITY : cost / resolved;
}

/**
 * Cost per resolved task in two arms run on the same tasks, with a paired
 * bootstrap over tasks (a task is resampled with both of its arm outcomes).
 * `control[i]` and `treatment[i]` must be the same task. Resamples in which
 * an arm resolves nothing are dropped; `iterations` reports how many were
 * kept.
 */
export function costPerResolvedDelta(
  control: ArmOutcome[],
  treatment: ArmOutcome[],
  opts: BootstrapOpts = {},
): CostPerResolvedDelta {
  if (control.length !== treatment.length) {
    throw new Error('control and treatment must list the same tasks in the same order');
  }
  const iterations = opts.iterations ?? 5000;
  const alpha = opts.alpha ?? 0.05;
  const c = costPerResolved(control);
  const t = costPerResolved(treatment);
  const rand = seededRandom(opts.seed ?? 1);
  const n = control.length;
  const deltas: number[] = [];
  const relatives: number[] = [];
  for (let b = 0; b < iterations && n > 0; b++) {
    const cs: ArmOutcome[] = [];
    const ts: ArmOutcome[] = [];
    for (let i = 0; i < n; i++) {
      const j = Math.floor(rand() * n);
      cs.push(control[j]!);
      ts.push(treatment[j]!);
    }
    const cc = costPerResolved(cs);
    const tt = costPerResolved(ts);
    if (!Number.isFinite(cc) || !Number.isFinite(tt)) continue;
    deltas.push(tt - cc);
    relatives.push((tt - cc) / cc);
  }
  const finite = Number.isFinite(c) && Number.isFinite(t);
  const empty = { low: Number.NaN, high: Number.NaN };
  return {
    control: c,
    treatment: t,
    delta: {
      estimate: finite ? t - c : Number.NaN,
      ...(deltas.length > 0 ? percentileInterval(deltas, alpha) : empty),
      iterations: deltas.length,
    },
    relative: {
      estimate: finite ? (t - c) / c : Number.NaN,
      ...(relatives.length > 0 ? percentileInterval(relatives, alpha) : empty),
      iterations: relatives.length,
    },
  };
}

/**
 * pass@k: share of tasks with at least one success in their first k runs.
 * NaN when no task has k runs (not measured, which is not the same as 0).
 */
export function passAtK(runsByTask: boolean[][], k: number): number {
  const eligible = runsByTask.filter((r) => r.length >= k);
  if (eligible.length === 0) return Number.NaN;
  return eligible.filter((r) => r.slice(0, k).some(Boolean)).length / eligible.length;
}

/**
 * pass^k: share of tasks whose first k runs all succeed (consistency).
 * NaN when no task has k runs.
 */
export function passHatK(runsByTask: boolean[][], k: number): number {
  const eligible = runsByTask.filter((r) => r.length >= k);
  if (eligible.length === 0) return Number.NaN;
  return eligible.filter((r) => r.slice(0, k).every(Boolean)).length / eligible.length;
}
