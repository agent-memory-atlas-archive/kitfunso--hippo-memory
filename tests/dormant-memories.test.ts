/**
 * Dormant memories: an opt-in alternative to deleting what fades.
 *
 * With `"dormant": { "enabled": true }` in config.json, the sleep decay pass
 * moves a memory that faded below the threshold out of active memory into
 * the dormant store instead of deleting it. Dormant memories never reach
 * recall or context, sit out every later sleep, and can be listed, searched,
 * restored or permanently forgotten. Off by default: without the setting a
 * faded memory is deleted exactly as before. Real SQLite throughout.
 */
import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  initStore,
  writeEntry,
  loadAllEntries,
  getExistingEntryMirrorPaths,
} from '../src/store.js';
import { openHippoDb, closeHippoDb } from '../src/db.js';
import { consolidate } from '../src/consolidate.js';
import { loadConfig } from '../src/config.js';
import { createMemory, Layer, calculateStrength, type MemoryEntry } from '../src/memory.js';
import { RejectedValueError, rejectionDigest, insertRejectedValue } from '../src/rejection.js';
import * as api from '../src/api.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const DORMANT_ON = JSON.stringify({ replay: { count: 0 }, dormant: { enabled: true } });
const DORMANT_OFF = JSON.stringify({ replay: { count: 0 } });

function tmpHome(prefix: string, config: string) {
  const home = mkdtempSync(join(tmpdir(), prefix));
  initStore(home);
  writeFileSync(join(home, 'config.json'), config, 'utf8');
  return { home, restore: () => rmSync(home, { recursive: true, force: true }) };
}

function aged(entry: MemoryEntry, days: number): MemoryEntry {
  const then = new Date(Date.now() - days * DAY_MS).toISOString();
  return { ...entry, created: then, last_retrieved: then };
}

function ctxFor(home: string, tenantId = 'default'): api.Context {
  return { hippoRoot: home, tenantId, actor: { subject: 'test', role: 'admin' } };
}

function countDormantRows(home: string): number {
  const db = openHippoDb(home);
  try {
    // SAFETY: row's shape matches the single aliased COUNT column in the SELECT.
    const row = db.prepare(`SELECT COUNT(*) AS n FROM dormant_memories`).get() as { n: number };
    return row.n;
  } finally {
    closeHippoDb(db);
  }
}

describe('dormant memories are opt-in', () => {
  it('without the setting a faded memory is deleted and nothing goes dormant', async () => {
    const { home, restore } = tmpHome('hippo-dormant-off-', DORMANT_OFF);
    try {
      const faded = aged(createMemory('the old staging hostname was build-07 before the move'), 90);
      writeEntry(home, faded);

      const result = await consolidate(home, { now: new Date() });

      expect(result.removed).toBe(1);
      expect(result.dormant).toBe(0);
      expect(loadAllEntries(home).map((e) => e.id)).not.toContain(faded.id);
      expect(countDormantRows(home)).toBe(0);
      expect(loadConfig(home).dormant.enabled).toBe(false);
    } finally {
      restore();
    }
  });

  it('a non-object "dormant" setting falls back to off and warns', () => {
    const { home, restore } = tmpHome('hippo-dormant-badcfg-', JSON.stringify({ dormant: true }));
    const warnings: string[] = [];
    const originalError = console.error;
    console.error = (...args: unknown[]) => { warnings.push(args.map(String).join(' ')); };
    try {
      expect(loadConfig(home).dormant.enabled).toBe(false);
      expect(warnings.some((w) => w.includes('"dormant"'))).toBe(true);
    } finally {
      console.error = originalError;
      restore();
    }
  });
});

describe('with dormant memories enabled', () => {
  it('sleep moves a faded memory out of active memory instead of deleting it', async () => {
    const { home, restore } = tmpHome('hippo-dormant-move-', DORMANT_ON);
    try {
      const faded = aged(createMemory('the old staging hostname was build-07 before the move', { tags: ['infra'] }), 90);
      const fresh = createMemory('the release checklist lives in docs/release-policy.md');
      writeEntry(home, faded);
      writeEntry(home, fresh);

      const result = await consolidate(home, { now: new Date() });

      expect(result.removed).toBe(0);
      expect(result.dormant).toBe(1);
      expect(result.details.some((d) => d.includes(faded.id) && d.includes('dormant'))).toBe(true);
      expect(loadAllEntries(home).map((e) => e.id)).toEqual([fresh.id]);
      // The markdown mirror goes too, so a bootstrap of an empty table
      // cannot re-import the row as active.
      expect(getExistingEntryMirrorPaths(home, faded.id)).toEqual([]);

      const dormant = api.listDormant(ctxFor(home));
      expect(dormant).toHaveLength(1);
      expect(dormant[0].id).toBe(faded.id);
      expect(dormant[0].content).toBe(faded.content);
      expect(dormant[0].tags).toEqual(['infra']);
      expect(dormant[0].reason).toBe('decay');
      expect(dormant[0].strength).toBeLessThan(0.05);
    } finally {
      restore();
    }
  });

  it('a dormant memory never reaches recall or context', async () => {
    const { home, restore } = tmpHome('hippo-dormant-recall-', DORMANT_ON);
    try {
      const faded = aged(createMemory('zanzibar gateway requires the legacy auth header'), 90);
      writeEntry(home, faded);
      await consolidate(home, { now: new Date() });

      const recalled = api.recall(ctxFor(home), { query: 'zanzibar gateway auth header' });
      expect(recalled.results.map((r) => r.id)).not.toContain(faded.id);
    } finally {
      restore();
    }
  });

  it('a dormant memory sits out every later sleep untouched', async () => {
    const { home, restore } = tmpHome('hippo-dormant-idle-', DORMANT_ON);
    try {
      const faded = aged(createMemory('the old staging hostname was build-07 before the move'), 90);
      writeEntry(home, faded);
      await consolidate(home, { now: new Date() });
      const before = api.listDormant(ctxFor(home));

      const second = await consolidate(home, { now: new Date(Date.now() + 30 * DAY_MS) });

      expect(second.dormant).toBe(0);
      expect(second.removed).toBe(0);
      expect(api.listDormant(ctxFor(home))).toEqual(before);
    } finally {
      restore();
    }
  });

  it('pinned memories and raw receipts never go dormant', async () => {
    const { home, restore } = tmpHome('hippo-dormant-exempt-', DORMANT_ON);
    try {
      const pinned = aged(createMemory('never force-push to master', { pinned: true }), 400);
      const receipt = aged(createMemory('slack receipt: the prod deploy failed on the stale cache', { layer: Layer.Episodic, kind: 'raw' }), 90);
      writeEntry(home, pinned);
      writeEntry(home, receipt);

      const result = await consolidate(home, { now: new Date() });

      expect(result.dormant).toBe(0);
      expect(loadAllEntries(home).map((e) => e.id).sort()).toEqual([pinned.id, receipt.id].sort());
      expect(api.listDormant(ctxFor(home))).toEqual([]);
    } finally {
      restore();
    }
  });

  it('a dry run reports the move but changes nothing', async () => {
    const { home, restore } = tmpHome('hippo-dormant-dry-', DORMANT_ON);
    try {
      const faded = aged(createMemory('the old staging hostname was build-07 before the move'), 90);
      writeEntry(home, faded);

      const result = await consolidate(home, { now: new Date(), dryRun: true });

      expect(result.dormant).toBe(1);
      expect(loadAllEntries(home).map((e) => e.id)).toEqual([faded.id]);
      expect(countDormantRows(home)).toBe(0);
    } finally {
      restore();
    }
  });

  it('api.sleep reports how many memories went dormant', async () => {
    const { home, restore } = tmpHome('hippo-dormant-sleep-', DORMANT_ON);
    try {
      writeEntry(home, aged(createMemory('the old staging hostname was build-07 before the move'), 90));

      const result = await api.sleep(ctxFor(home), { noShare: true });

      expect(result.dormant).toBe(1);
      expect(result.removed).toBe(0);
    } finally {
      restore();
    }
  });
});

describe('listing, restoring and forgetting dormant memories', () => {
  async function storeWithDormant(prefix: string, contents: string[]) {
    const { home, restore } = tmpHome(prefix, DORMANT_ON);
    const ids: string[] = [];
    for (const content of contents) {
      const entry = aged(createMemory(content), 90);
      writeEntry(home, entry);
      ids.push(entry.id);
    }
    await consolidate(home, { now: new Date() });
    return { home, restore, ids };
  }

  it('search matches every term, case-insensitively, and treats % and _ literally', async () => {
    const { home, restore, ids } = await storeWithDormant('hippo-dormant-search-', [
      'Deploys to Staging need the VPN profile',
      'staging database snapshots rotate weekly',
      'coverage stays at 100% for the parser',
      'the env var is named HIPPO_TENANT',
    ]);
    try {
      expect(api.listDormant(ctxFor(home), { query: 'staging vpn' }).map((m) => m.id)).toEqual([ids[0]]);
      expect(api.listDormant(ctxFor(home), { query: 'STAGING' })).toHaveLength(2);
      expect(api.listDormant(ctxFor(home), { query: '100%' }).map((m) => m.id)).toEqual([ids[2]]);
      expect(api.listDormant(ctxFor(home), { query: 'hippo_tenant' }).map((m) => m.id)).toEqual([ids[3]]);
      // As LIKE wildcards these would match "staging database" and
      // "to Staging need"; taken literally they match nothing.
      expect(api.listDormant(ctxFor(home), { query: 'g_d' })).toEqual([]);
      expect(api.listDormant(ctxFor(home), { query: 'to%need' })).toEqual([]);
      expect(api.listDormant(ctxFor(home), { limit: 2 })).toHaveLength(2);
    } finally {
      restore();
    }
  });

  it('restore brings a memory back as if just recalled, and it survives the next sleep', async () => {
    const { home, restore, ids } = await storeWithDormant('hippo-dormant-restore-', [
      'zanzibar gateway requires the legacy auth header',
    ]);
    try {
      const before = Date.now();
      const restored = api.restoreDormant(ctxFor(home), ids[0]);

      expect(restored.id).toBe(ids[0]);
      expect(Date.parse(restored.last_retrieved)).toBeGreaterThanOrEqual(before - 1000);
      expect(calculateStrength(restored, new Date())).toBeGreaterThan(0.9);
      expect(api.listDormant(ctxFor(home))).toEqual([]);
      expect(api.recall(ctxFor(home), { query: 'zanzibar gateway auth header' }).results.map((r) => r.id)).toContain(ids[0]);

      const next = await consolidate(home, { now: new Date() });
      expect(next.dormant).toBe(0);
      expect(loadAllEntries(home).map((e) => e.id)).toContain(ids[0]);
    } finally {
      restore();
    }
  });

  it('restore refuses an unknown id, another tenant\'s memory, and an id that is already active', async () => {
    const { home, restore, ids } = await storeWithDormant('hippo-dormant-guard-', [
      'zanzibar gateway requires the legacy auth header',
    ]);
    try {
      expect(() => api.restoreDormant(ctxFor(home), 'mem_doesnotexist')).toThrow(/dormant memory not found/);
      expect(() => api.restoreDormant(ctxFor(home, 'tenant-b'), ids[0])).toThrow(/dormant memory not found/);
      expect(api.listDormant(ctxFor(home, 'tenant-b'))).toEqual([]);

      // Same id written back as active (e.g. by an old binary): restore must
      // not overwrite the live row with the older snapshot.
      const live = { ...createMemory('live copy under the same id'), id: ids[0] };
      writeEntry(home, live);
      expect(() => api.restoreDormant(ctxFor(home), ids[0])).toThrow(/already active/);
      expect(api.listDormant(ctxFor(home)).map((m) => m.id)).toEqual([ids[0]]);
    } finally {
      restore();
    }
  });

  it('rejecting a value also purges its dormant copies', async () => {
    const { home, restore, ids } = await storeWithDormant('hippo-dormant-rejected-', [
      'the staging api key lives in the shared vault entry',
    ]);
    try {
      api.reject(ctxFor(home), { value: 'the staging api key lives in the shared vault entry', reason: 'stale secret pointer' });
      // A rejected value may not linger in dormant storage either.
      expect(api.listDormant(ctxFor(home))).toEqual([]);
      expect(() => api.restoreDormant(ctxFor(home), ids[0])).toThrow(/dormant memory not found/);
    } finally {
      restore();
    }
  });

  it('restore honours a tombstone that skipped the purge, and keeps the dormant copy in place', async () => {
    const { home, restore, ids } = await storeWithDormant('hippo-dormant-guard-old-', [
      'the staging api key lives in the shared vault entry',
    ]);
    try {
      // Simulate a tombstone written without the dormant purge (an old binary
      // sharing the store): insert the tombstone row directly.
      const db = openHippoDb(home);
      try {
        insertRejectedValue(db, {
          tenantId: 'default',
          digest: rejectionDigest('the staging api key lives in the shared vault entry'),
          reason: 'old binary',
          rejectedBy: 'test',
          rejectedAt: new Date().toISOString(),
          sourceMemoryId: null,
          normalizedChars: 10,
        });
      } finally {
        closeHippoDb(db);
      }
      expect(() => api.restoreDormant(ctxFor(home), ids[0])).toThrow(RejectedValueError);
      expect(api.listDormant(ctxFor(home)).map((m) => m.id)).toEqual([ids[0]]);
      expect(loadAllEntries(home).map((e) => e.id)).not.toContain(ids[0]);
    } finally {
      restore();
    }
  });

  it('forget deletes a dormant memory permanently, tenant-scoped', async () => {
    const { home, restore, ids } = await storeWithDormant('hippo-dormant-forget-', [
      'zanzibar gateway requires the legacy auth header',
    ]);
    try {
      expect(() => api.forgetDormant(ctxFor(home, 'tenant-b'), ids[0])).toThrow(/dormant memory not found/);
      api.forgetDormant(ctxFor(home), ids[0]);
      expect(api.listDormant(ctxFor(home))).toEqual([]);
      expect(() => api.restoreDormant(ctxFor(home), ids[0])).toThrow(/dormant memory not found/);
    } finally {
      restore();
    }
  });
});

describe('hippo dormant CLI', () => {
  const CLI_PATH = join(__dirname, '..', 'dist', 'cli.js');

  function runCli(cwd: string, ...args: string[]) {
    try {
      const out = execFileSync(process.execPath, [CLI_PATH, ...args], {
        cwd, env: { ...process.env }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
      });
      return { out, status: 0 };
    } catch (e) {
      // SAFETY: execFileSync attaches stdout/stderr/status to the thrown Error
      // on a non-zero child exit (Node child_process sync error contract).
      const err = e as { stdout?: string; stderr?: string; status?: number };
      return { out: `${err.stdout ?? ''}${err.stderr ?? ''}`, status: err.status ?? 1 };
    }
  }

  it('lists, restores and forgets dormant memories', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'hippo-dormant-cli-'));
    const hippoRoot = join(workspace, '.hippo');
    try {
      initStore(hippoRoot);
      writeFileSync(join(hippoRoot, 'config.json'), DORMANT_ON, 'utf8');
      const keep = aged(createMemory('zanzibar gateway requires the legacy auth header'), 90);
      const drop = aged(createMemory('the old staging hostname was build-07 before the move'), 90);
      writeEntry(hippoRoot, keep);
      writeEntry(hippoRoot, drop);
      await consolidate(hippoRoot, { now: new Date() });

      const list = runCli(workspace, 'dormant');
      expect(list.status).toBe(0);
      expect(list.out).toContain('2 dormant memories');
      expect(list.out).toContain(keep.id);

      const search = runCli(workspace, 'dormant', 'zanzibar', '--json');
      expect(search.status).toBe(0);
      // SAFETY: `hippo dormant --json` prints a JSON object with a `dormant` array (cmdDormant).
      const parsed = JSON.parse(search.out) as { dormant: Array<{ id: string }> };
      expect(parsed.dormant.map((m) => m.id)).toEqual([keep.id]);

      const restored = runCli(workspace, 'dormant', 'restore', keep.id);
      expect(restored.status).toBe(0);
      expect(restored.out).toContain(`Restored ${keep.id}`);

      const forgotten = runCli(workspace, 'dormant', 'forget', drop.id);
      expect(forgotten.status).toBe(0);
      expect(forgotten.out).toContain(`Forgot dormant memory ${drop.id}`);

      expect(runCli(workspace, 'dormant').out).toContain('No dormant memories');
      expect(runCli(workspace, 'dormant', 'restore', drop.id).status).not.toBe(0);

      // `hippo forget` on a dormant id points at the dormant command instead
      // of a bare "not found".
      writeEntry(hippoRoot, aged(createMemory('a third faded memory about the retired cron host'), 90));
      await consolidate(hippoRoot, { now: new Date() });
      const [third] = api.listDormant(ctxFor(hippoRoot));
      const hint = runCli(workspace, 'forget', third.id);
      expect(hint.status).not.toBe(0);
      expect(hint.out).toContain(`hippo dormant forget ${third.id}`);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });
});
