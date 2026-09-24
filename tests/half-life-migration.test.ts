/**
 * Changing the default half-life moves memories still on the old base, once,
 * with the ids in the audit log; memories hippo shortened, or that carry
 * their own half-life, keep theirs; a dry run writes nothing.
 * Real stores, no mocks.
 */
import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { initStore, writeEntry, loadAllEntries } from '../src/store.js';
import { createMemory, deriveHalfLife } from '../src/memory.js';
import { migrateDefaultHalfLife, storeHalfLifeBase, planHalfLifeMigration } from '../src/half-life-migration.js';
import { openHippoDb, closeHippoDb } from '../src/db.js';
import { consolidate } from '../src/consolidate.js';

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) fs.rmSync(dirs.pop()!, { recursive: true, force: true });
});
function store(): string {
  const root = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'hippo-hl-')), '.hippo');
  dirs.push(path.dirname(root));
  initStore(root);
  return root;
}
function byContent(root: string): Map<string, number> {
  return new Map(loadAllEntries(root).map((e) => [e.content, e.half_life_days]));
}

describe('default half-life migration', () => {
  it('moves only memories still on the old base, once, and logs their ids', () => {
    const root = store();
    const plain = createMemory('the staging deploy needs the VPN to reach the health check');
    const error = createMemory('npm install fails in billing; use pnpm', { tags: ['error'] });
    const shortened = createMemory('an invalidated memory hippo already halved');
    shortened.half_life_days = 3;
    const fixed = createMemory('decision: we release on Tuesdays');
    fixed.half_life_days = 90;
    for (const e of [plain, error, shortened, fixed]) writeEntry(root, e);

    expect(storeHalfLifeBase(root)).toBe(7);
    const r = migrateDefaultHalfLife(root, 365);
    expect(r).toMatchObject({ from: 7, to: 365, rescaled: 2, kept: 2, dryRun: false });

    const hl = byContent(root);
    expect(hl.get(plain.content)).toBe(deriveHalfLife(365, plain));
    expect(hl.get(error.content)).toBe(730);
    expect(hl.get(shortened.content)).toBe(3);
    expect(hl.get(fixed.content)).toBe(90);
    expect(storeHalfLifeBase(root)).toBe(365);

    expect(migrateDefaultHalfLife(root, 365).rescaled).toBe(0);

    const db = openHippoDb(root);
    try {
      // SAFETY: SELECT of one TEXT column.
      const rows = db.prepare(`SELECT metadata_json FROM audit_log WHERE op = 'half_life_migrate'`).all() as { metadata_json: string }[];
      expect(rows).toHaveLength(1);
      expect(JSON.parse(rows[0]!.metadata_json)).toMatchObject({ from: 7, to: 365 });
      expect(JSON.parse(rows[0]!.metadata_json).ids.sort()).toEqual([plain.id, error.id].sort());
    } finally {
      closeHippoDb(db);
    }
  });

  it('can be undone by migrating back', () => {
    const root = store();
    const plain = createMemory('the staging deploy needs the VPN to reach the health check');
    writeEntry(root, plain);
    migrateDefaultHalfLife(root, 365);
    migrateDefaultHalfLife(root, 7);
    expect(byContent(root).get(plain.content)).toBe(7);
    expect(storeHalfLifeBase(root)).toBe(7);
  });

  it('a dry run and an unchanged default write nothing', () => {
    const root = store();
    writeEntry(root, createMemory('the staging deploy needs the VPN to reach the health check'));
    expect(migrateDefaultHalfLife(root, 365, { dryRun: true })).toMatchObject({ rescaled: 1, dryRun: true });
    expect([...byContent(root).values()]).toEqual([7]);
    expect(storeHalfLifeBase(root)).toBe(7);
    expect(migrateDefaultHalfLife(root, 7)).toMatchObject({ rescaled: 0 });
    expect(planHalfLifeMigration(loadAllEntries(root), 7, 7)).toEqual([]);
  });

  it('sleep applies a changed defaultHalfLifeDays before decaying', async () => {
    const root = store();
    writeEntry(root, createMemory('the staging deploy needs the VPN to reach the health check'));
    fs.writeFileSync(path.join(root, 'config.json'), JSON.stringify({ defaultHalfLifeDays: 365 }));
    const result = await consolidate(root);
    expect(result.details.join('\n')).toMatch(/moved 1 memories from the 7-day to the 365-day half-life/);
    // Sleep's replay pass may lengthen it further (+2 days per replay).
    expect([...byContent(root).values()][0]).toBeGreaterThanOrEqual(365);
  });
});
