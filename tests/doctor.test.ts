/**
 * `hippo doctor`: read-only health report with a fix for every warn or fail.
 * Real stores, real settings files, the built CLI for the exit code.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { initStore, writeEntry } from '../src/store.js';
import { createMemory } from '../src/memory.js';
import { runDoctor, formatDoctor } from '../src/doctor.js';

const HIPPO_JS = resolve(__dirname, '..', 'bin', 'hippo.js');
const dirs: string[] = [];
const origHome = process.env.HIPPO_HOME;
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
  if (origHome === undefined) delete process.env.HIPPO_HOME;
  else process.env.HIPPO_HOME = origHome;
});
function tmp(prefix: string): string {
  const d = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(d);
  return d;
}

describe('hippo doctor', () => {
  it('fails with a fix when there is no store, and creates nothing', () => {
    const cwd = tmp('doctor-empty-');
    process.env.HIPPO_HOME = join(cwd, 'global');
    const r = runDoctor({ cwd, home: cwd, version: 'test' });
    expect(r.ok).toBe(false);
    const store = r.checks.find((c) => c.id === 'store')!;
    expect(store.status).toBe('fail');
    expect(store.fix).toMatch(/hippo init/);
    expect(existsSync(join(cwd, '.hippo'))).toBe(false);
    expect(existsSync(join(cwd, 'global'))).toBe(false);
  });

  it('passes on a healthy project store and reports hooks, memories and sleep', () => {
    const cwd = tmp('doctor-ok-');
    process.env.HIPPO_HOME = join(cwd, 'global');
    initStore(join(cwd, '.hippo'));
    writeEntry(join(cwd, '.hippo'), createMemory('the staging deploy needs the VPN to reach the health check'));
    mkdirSync(join(cwd, '.claude'));
    writeFileSync(join(cwd, '.claude', 'settings.json'), JSON.stringify({ hooks: {
      UserPromptSubmit: [{ hooks: [{ type: 'command', command: 'hippo context --pinned-only --include-recent 5 --format additional-context' }] }],
      SessionEnd: [{ hooks: [{ type: 'command', command: 'hippo session-end --log-file x' }] }],
      PreCompact: [{ hooks: [{ type: 'command', command: 'hippo pre-compact --log-file x' }] }],
      SessionStart: [{ matcher: 'compact', hooks: [{ type: 'command', command: 'hippo compact-resume' }] }],
      PostToolUseFailure: [{ matcher: '.*', hooks: [{ type: 'command', command: 'hippo capture-error' }] }],
    } }));
    const r = runDoctor({ cwd, home: cwd, version: 'test' });
    expect(r.ok).toBe(true);
    const status = Object.fromEntries(r.checks.map((c) => [c.id, c.status]));
    expect(status).toMatchObject({ node: 'pass', store: 'pass', schema: 'pass', memories: 'info', 'claude-code': 'pass', sleep: 'warn' });
    expect(formatDoctor(r)).toContain('fix: hippo sleep');
  });

  it('flags old Node, missing Claude Code hooks, and accepts the plugin instead of hooks', () => {
    const cwd = tmp('doctor-warn-');
    process.env.HIPPO_HOME = join(cwd, 'global');
    initStore(join(cwd, '.hippo'));
    mkdirSync(join(cwd, '.claude'));
    writeFileSync(join(cwd, '.claude', 'settings.json'), '{}');
    const r = runDoctor({ cwd, home: cwd, version: 'test', nodeVersion: '20.11.0' });
    expect(r.checks.find((c) => c.id === 'node')!.status).toBe('fail');
    expect(r.checks.find((c) => c.id === 'claude-code')!.fix).toBe('hippo hook install claude-code');
    expect(r.checks.find((c) => c.id === 'memories')!.status).toBe('warn');

    writeFileSync(join(cwd, '.claude', 'settings.json'), JSON.stringify({ enabledPlugins: { 'hippo-memory@hippo-memory': true } }));
    expect(runDoctor({ cwd, home: cwd, version: 'test' }).checks.find((c) => c.id === 'claude-code')!.status).toBe('pass');
  });

  it('exits 1 with --json when a check fails', () => {
    const cwd = tmp('doctor-cli-');
    let status = 0;
    let out = '';
    try {
      out = execFileSync(process.execPath, [HIPPO_JS, 'doctor', '--json'], { cwd, env: { ...process.env, HIPPO_HOME: join(cwd, 'global'), HOME: cwd }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    } catch (e) {
      // SAFETY: execFileSync attaches stdout and status to the thrown Error on a non-zero exit.
      const err = e as { stdout?: string; status?: number };
      out = err.stdout ?? '';
      status = err.status ?? 1;
    }
    expect(status).toBe(1);
    expect(JSON.parse(out).checks.find((c: { id: string }) => c.id === 'store').status).toBe('fail');
  });
});
