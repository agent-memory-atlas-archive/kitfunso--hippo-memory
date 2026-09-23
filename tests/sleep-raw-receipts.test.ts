/**
 * Sleep must never try to delete a raw receipt.
 *
 * kind='raw' rows (Slack / GitHub connector messages, `hippo import --vault`
 * notes) are append-only: a BEFORE DELETE trigger aborts any DELETE, and
 * archiveRawMemory is the only sanctioned removal path. Two sleep phases used
 * to issue a plain DELETE for them, which aborted the whole sleep and every
 * later one:
 *   - the consolidate decay pass, once a receipt faded below the threshold
 *     (about 30 days unrecalled at the default 7-day half-life);
 *   - the quality audit, for any receipt shorter than 10 characters ("lgtm").
 * Real SQLite throughout, no mocks.
 */
import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initStore, writeEntry, loadAllEntries } from '../src/store.js';
import { consolidate } from '../src/consolidate.js';
import { createMemory, Layer, type MemoryEntry } from '../src/memory.js';
import { auditMemory } from '../src/audit.js';
import * as api from '../src/api.js';

const DAY_MS = 24 * 60 * 60 * 1000;

function tmpHome(prefix: string, config?: string) {
  const home = mkdtempSync(join(tmpdir(), prefix));
  initStore(home);
  // Replay off keeps the decay assertions deterministic (replay re-strengthens
  // a random sample of survivors).
  writeFileSync(join(home, 'config.json'), config ?? JSON.stringify({ replay: { count: 0 } }), 'utf8');
  return { home, restore: () => rmSync(home, { recursive: true, force: true }) };
}

function aged(entry: MemoryEntry, days: number): MemoryEntry {
  const then = new Date(Date.now() - days * DAY_MS).toISOString();
  return { ...entry, created: then, last_retrieved: then };
}

function ctxFor(home: string): api.Context {
  return { hippoRoot: home, tenantId: 'default', actor: { subject: 'test', role: 'admin' } };
}

describe('sleep keeps raw receipts instead of aborting on the append-only trigger', () => {
  it('a faded raw receipt no longer aborts consolidate, and the rest of the cycle still commits', async () => {
    const { home, restore } = tmpHome('hippo-raw-decay-');
    try {
      const receipt = aged(createMemory('slack receipt: prod deploy failed on the stale cache', { layer: Layer.Episodic, kind: 'raw' }), 90);
      const faded = aged(createMemory('an ordinary observation about the build cache nobody recalled', { layer: Layer.Episodic }), 90);
      writeEntry(home, receipt);
      writeEntry(home, faded);

      const result = await consolidate(home, { now: new Date() });

      const ids = loadAllEntries(home).map((e) => e.id);
      expect(ids).toContain(receipt.id);
      // The ordinary faded memory is still removed: the batch committed.
      expect(ids).not.toContain(faded.id);
      expect(result.removed).toBe(1);
      expect(result.details.some((d) => d.includes(receipt.id) && d.includes('raw receipt'))).toBe(true);
    } finally {
      restore();
    }
  });

  it('a faded raw receipt no longer aborts consolidate with the learned memory-value rescue on', async () => {
    const { home, restore } = tmpHome(
      'hippo-raw-decay-mv-',
      JSON.stringify({ replay: { count: 0 }, memoryValue: { enabled: true } }),
    );
    try {
      const receipt = aged(createMemory('github receipt: issue about the flaky integration suite', { layer: Layer.Episodic, kind: 'raw' }), 90);
      writeEntry(home, receipt);
      for (let i = 0; i < 12; i++) {
        writeEntry(home, aged(createMemory(`faded observation number ${i} about module ${i} internals`, { layer: Layer.Episodic }), 90));
      }

      await consolidate(home, { now: new Date() });

      expect(loadAllEntries(home).map((e) => e.id)).toContain(receipt.id);
    } finally {
      restore();
    }
  });

  it('a faded raw receipt is kept but sits out the rest of the cycle (no merge into a new semantic memory)', async () => {
    const { home, restore } = tmpHome('hippo-raw-decay-inert-');
    try {
      const a = aged(createMemory('deploy failed because the cache was stale on prod server alpha', { layer: Layer.Episodic, kind: 'raw' }), 90);
      const b = aged(createMemory('deploy failed because the cache was stale on prod server beta', { layer: Layer.Episodic, kind: 'raw' }), 90);
      writeEntry(home, a);
      writeEntry(home, b);

      const result = await consolidate(home, { now: new Date() });

      expect(result.semanticCreated).toBe(0);
      const rows = loadAllEntries(home);
      expect(rows.map((e) => e.id).sort()).toEqual([a.id, b.id].sort());
      expect(rows.every((e) => e.kind === 'raw')).toBe(true);
    } finally {
      restore();
    }
  });

  it('a short raw receipt no longer aborts api.sleep at the quality audit', async () => {
    const { home, restore } = tmpHome('hippo-raw-audit-');
    try {
      const receipt = createMemory('lgtm', { layer: Layer.Episodic, kind: 'raw' });
      const junk = createMemory('wip fix', { layer: Layer.Episodic });
      writeEntry(home, receipt);
      writeEntry(home, junk);

      const result = await api.sleep(ctxFor(home), { noShare: true });

      const ids = loadAllEntries(home).map((e) => e.id);
      expect(ids).toContain(receipt.id);
      // Ordinary junk is still cleaned up; only the receipt is exempt.
      expect(ids).not.toContain(junk.id);
      expect(result.audit?.errorsRemoved).toBe(1);
    } finally {
      restore();
    }
  });

  it('the quality audit never flags a raw receipt, so `hippo audit --fix` cannot hit the trigger either', () => {
    const receipt = createMemory('lgtm', { layer: Layer.Episodic, kind: 'raw' });
    const junk = createMemory('wip fix', { layer: Layer.Episodic });
    expect(auditMemory(receipt)).toBeNull();
    expect(auditMemory(junk)?.severity).toBe('error');
  });
});
