/**
 * Moving a store's memories to a new default half-life.
 *
 * Each memory stores its own `half_life_days`, set at write from the
 * default base and a few write-time multipliers (`deriveHalfLife`). Changing
 * the default therefore reaches only new memories; without this migration a
 * store would mix old-base and new-base memories, a state the decay
 * evaluation never tested (docs/evals/2026-09-24-decay-default-prereg.md,
 * Migration). The rule, declared there before any run:
 *
 * - only a memory still on the old base is rescaled: its half-life equals
 *   `deriveHalfLife(from, entry)` exactly. A memory hippo shortened since
 *   (invalidated, superseded, a merge source, marked bad) or one with its own
 *   fixed half-life (decisions, incidents, customer notes) keeps its value;
 * - every rescale is written to the audit log with the ids, so it can be
 *   undone, and the store records the base it is on (`meta`), so the
 *   migration runs once.
 *
 * `hippo sleep` runs it before its decay pass, from the base the store is on
 * (7 days when never recorded) to the configured `defaultHalfLifeDays`.
 */
import { deriveHalfLife, type MemoryEntry } from './memory.js';
import { loadAllEntries, batchWriteAndDelete } from './store.js';
import { openHippoDb, closeHippoDb, getMeta, setMeta } from './db.js';
import { appendAuditEvent } from './audit.js';

/** The base every store used before the base was recorded. */
export const LEGACY_HALF_LIFE_BASE = 7;

/** `meta` key holding the base a store's memories are on. */
export const HALF_LIFE_BASE_META_KEY = 'default_half_life_base';

/** What {@link migrateDefaultHalfLife} did, or would do under `dryRun`. */
export interface HalfLifeMigrationResult {
  from: number;
  to: number;
  /** Memories moved to the new base. */
  rescaled: number;
  /** Memories left alone because they are not on the old base. */
  kept: number;
  dryRun: boolean;
}

/** True when `entry` still carries the half-life `base` gave it at write. */
export function isOnHalfLifeBase(entry: Pick<MemoryEntry, 'half_life_days' | 'tags' | 'schema_fit'>, base: number): boolean {
  return Math.abs(entry.half_life_days - deriveHalfLife(base, entry)) < 1e-9;
}

/**
 * The entries to rescale from base `from` to base `to`, as updated copies.
 * Pure: reads nothing and writes nothing.
 */
export function planHalfLifeMigration(entries: readonly MemoryEntry[], from: number, to: number): MemoryEntry[] {
  if (from === to) return [];
  return entries
    .filter((e) => isOnHalfLifeBase(e, from))
    .map((e) => ({ ...e, half_life_days: deriveHalfLife(to, e) }));
}

/** The base this store's memories are on. */
export function storeHalfLifeBase(hippoRoot: string): number {
  const db = openHippoDb(hippoRoot);
  try {
    const raw = Number(getMeta(db, HALF_LIFE_BASE_META_KEY, String(LEGACY_HALF_LIFE_BASE)));
    return Number.isFinite(raw) && raw > 0 ? raw : LEGACY_HALF_LIFE_BASE;
  } finally {
    closeHippoDb(db);
  }
}

/**
 * Move the store's memories from the base they are on to `to`. A no-op when
 * they are already on it. Under `dryRun` nothing is written, the recorded
 * base included.
 */
export function migrateDefaultHalfLife(hippoRoot: string, to: number, opts: { dryRun?: boolean; actor?: string } = {}): HalfLifeMigrationResult {
  const dryRun = opts.dryRun ?? false;
  const from = storeHalfLifeBase(hippoRoot);
  if (!(Number.isFinite(to) && to > 0) || from === to) return { from, to, rescaled: 0, kept: 0, dryRun };

  const all = loadAllEntries(hippoRoot);
  const plan = planHalfLifeMigration(all, from, to);
  const result: HalfLifeMigrationResult = { from, to, rescaled: plan.length, kept: all.length - plan.length, dryRun };
  if (dryRun) return result;

  if (plan.length > 0) batchWriteAndDelete(hippoRoot, plan, []);
  const db = openHippoDb(hippoRoot);
  try {
    const byTenant = new Map<string, string[]>();
    for (const e of plan) byTenant.set(e.tenantId, [...(byTenant.get(e.tenantId) ?? []), e.id]);
    for (const [tenantId, ids] of byTenant) {
      appendAuditEvent(db, { tenantId, actor: opts.actor ?? 'system', op: 'half_life_migrate', metadata: { from, to, ids } });
    }
    setMeta(db, HALF_LIFE_BASE_META_KEY, String(to));
  } finally {
    closeHippoDb(db);
  }
  return result;
}
