import { describe, it, expect } from 'vitest';
import {
  addUsage,
  priceUsage,
  uncachedEquivalentInput,
  seededRandom,
  pairedBootstrap,
  clusteredPairedBootstrap,
  costPerResolvedDelta,
  passAtK,
  passHatK,
} from '../src/eval-stats.js';

describe('four-bucket cost accounting', () => {
  const usage = { inputTokens: 1_000_000, cacheWriteTokens: 2_000_000, cacheReadTokens: 10_000_000, outputTokens: 500_000 };

  it('prices each bucket at its own rate', () => {
    const prices = { inputPerMTok: 3, cacheWritePerMTok: 3.75, cacheReadPerMTok: 0.3, outputPerMTok: 15 };
    expect(priceUsage(usage, prices)).toBeCloseTo(3 + 7.5 + 3 + 7.5, 10);
  });

  it('converts input to uncached-equivalent tokens with cache ratios', () => {
    expect(uncachedEquivalentInput(usage)).toBeCloseTo(1_000_000 + 2_500_000 + 1_000_000, 6);
    expect(uncachedEquivalentInput(usage, { write: 1, read: 0.5 })).toBe(8_000_000);
  });

  it('adds usages bucket by bucket', () => {
    expect(addUsage(usage, usage).cacheReadTokens).toBe(20_000_000);
    expect(addUsage()).toEqual({ inputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 0, outputTokens: 0 });
  });

  it('shows why raw tokens overstate savings when input is mostly cache reads', () => {
    // Cutting 10% of the cached history saves far less than 10% of the input bill.
    const before = { inputTokens: 5_000, cacheWriteTokens: 5_000, cacheReadTokens: 900_000, outputTokens: 0 };
    const after = { ...before, cacheReadTokens: 810_000 };
    const rawCut = 1 - (after.inputTokens + after.cacheWriteTokens + after.cacheReadTokens)
      / (before.inputTokens + before.cacheWriteTokens + before.cacheReadTokens);
    const billCut = 1 - uncachedEquivalentInput(after) / uncachedEquivalentInput(before);
    expect(rawCut).toBeGreaterThan(0.09);
    expect(billCut).toBeGreaterThan(rawCut * 0.8);
    expect(billCut).toBeLessThan(0.1);
  });
});

describe('bootstrap', () => {
  it('is deterministic for a seed', () => {
    const a = seededRandom(42);
    const b = seededRandom(42);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
    const diffs = [0.1, -0.2, 0.3, 0.05, 0.2, -0.1, 0.15];
    expect(pairedBootstrap(diffs, { seed: 7 })).toEqual(pairedBootstrap(diffs, { seed: 7 }));
  });

  it('brackets a clear effect away from zero and a null effect around zero', () => {
    const rand = seededRandom(3);
    const clear = Array.from({ length: 200 }, () => 1 + (rand() - 0.5));
    const est = pairedBootstrap(clear);
    expect(est.estimate).toBeCloseTo(1, 1);
    expect(est.low).toBeGreaterThan(0);
    const noise = Array.from({ length: 200 }, () => rand() - 0.5);
    const nul = pairedBootstrap(noise);
    expect(nul.low).toBeLessThan(0);
    expect(nul.high).toBeGreaterThan(0);
  });

  it('gives a wider interval when clustering is respected', () => {
    // Five repos, each with a shared offset: tasks inside a repo move together.
    const byCluster = new Map<string, number[]>();
    const offsets = [-1, -0.5, 0, 0.5, 1.2];
    offsets.forEach((o, i) => byCluster.set(`repo${i}`, Array.from({ length: 30 }, (_, j) => o + (j % 3) * 0.01)));
    const clustered = clusteredPairedBootstrap(byCluster);
    const naive = pairedBootstrap([...byCluster.values()].flat());
    expect(clustered.estimate).toBeCloseTo(naive.estimate, 10);
    expect(clustered.high - clustered.low).toBeGreaterThan(3 * (naive.high - naive.low));
  });

  it('handles empty input', () => {
    expect(pairedBootstrap([])).toEqual({ estimate: 0, low: 0, high: 0, iterations: 0 });
    expect(clusteredPairedBootstrap(new Map()).iterations).toBe(0);
  });
});

describe('cost per resolved task', () => {
  it('computes the paired delta and its interval', () => {
    const control = Array.from({ length: 60 }, (_, i) => ({ cost: 1, resolved: i % 2 === 0 }));
    const treatment = Array.from({ length: 60 }, (_, i) => ({ cost: 0.8, resolved: i % 2 === 0 }));
    const r = costPerResolvedDelta(control, treatment);
    expect(r.control).toBeCloseTo(2, 10);
    expect(r.treatment).toBeCloseTo(1.6, 10);
    expect(r.relative.estimate).toBeCloseTo(-0.2, 10);
    expect(r.relative.high).toBeLessThan(0);
  });

  it('refuses unpaired arms and reports an arm that resolves nothing', () => {
    expect(() => costPerResolvedDelta([{ cost: 1, resolved: true }], [])).toThrow(/same tasks/);
    const r = costPerResolvedDelta([{ cost: 1, resolved: false }], [{ cost: 1, resolved: true }]);
    expect(r.control).toBe(Number.POSITIVE_INFINITY);
    expect(Number.isNaN(r.delta.estimate)).toBe(true);
  });
});

describe('pass@k and pass^k', () => {
  const runs = [[true, false, true], [false, false, false], [true, true, true], [false, true]];
  it('pass@k counts any success in the first k runs', () => {
    expect(passAtK(runs, 1)).toBeCloseTo(2 / 4, 10);
    expect(passAtK(runs, 3)).toBeCloseTo(2 / 3, 10);
  });
  it('is not a number when no task has k runs', () => {
    expect(Number.isNaN(passAtK([[true]], 3))).toBe(true);
    expect(Number.isNaN(passHatK([], 1))).toBe(true);
  });
  it('pass^k counts all-success in the first k runs', () => {
    expect(passHatK(runs, 2)).toBeCloseTo(1 / 4, 10);
    expect(passHatK(runs, 3)).toBeCloseTo(1 / 3, 10);
  });
});
