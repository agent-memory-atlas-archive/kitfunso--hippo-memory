/**
 * TE5 runner end to end, with a stand-in for Claude Code
 * (tests/fixtures/fake-claude.mjs) so it costs nothing: real git clones,
 * real hidden-test grading, hippo's real hooks, ledger and CLI, and the
 * analyzer on the records it writes. The stand-in's token numbers are made
 * up; this checks orchestration and records, not any result.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { runAll, planRuns, validateTasks, usageFromResult } from '../scripts/token-eval/ab-run.mjs';
import { parseRuns, analyze } from '../scripts/token-eval/ab-analyze.mjs';

const FAKE = resolve(__dirname, 'fixtures', 'fake-claude.mjs');
const dirs: string[] = [];
afterEach(() => { while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true }); });

/** A throwaway repository with a buggy base commit and a fix commit that adds its test. */
interface FixtureRepo {
  repo: string;
  base: string;
  fix: string;
}

function makeRepo(): FixtureRepo {
  const repo = mkdtempSync(join(tmpdir(), 'ab-run-repo-'));
  dirs.push(repo);
  const git = (...args: string[]): string => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
  git('init', '-q');
  git('config', 'user.email', 't@example.com');
  git('config', 'user.name', 'T');
  git('config', 'commit.gpgsign', 'false');
  writeFileSync(join(repo, 'lib.js'), 'module.exports.add = (a, b) => a - b;\n');
  git('add', '.');
  git('commit', '-qm', 'base');
  const base = git('rev-parse', 'HEAD');
  writeFileSync(join(repo, 'lib.js'), 'module.exports.add = (a, b) => a + b;\n');
  writeFileSync(join(repo, 'test.js'), "const { add } = require('./lib.js');\nif (add(2, 3) !== 5) { console.error('add is wrong'); process.exit(1); }\n");
  git('add', '.');
  git('commit', '-qm', 'fix add and test it');
  return { repo, base, fix: git('rev-parse', 'HEAD') };
}

function spec(repo: string, base: string, fix: string) {
  const task = (id: string, prompt: string) => ({ id, baseRef: base, fixRef: fix, prompt, testFiles: ['test.js'], test: 'node test.js' });
  return validateTasks({
    sequences: [
      { id: 'seqA', cluster: 'repoA', repo, tasks: [task('a1', 'FIX add in lib.js'), task('a2', 'FIX add again NOREMEMBER'), task('a3', 'look around only')] },
      { id: 'seqB', cluster: 'repoB', repo, tasks: [task('b1', 'FIX add in lib.js'), task('b2', 'look around only')] },
    ],
  });
}

describe('A/B runner (TE5)', () => {
  it('validates task files', () => {
    expect(() => validateTasks({ sequences: [] })).toThrow(/non-empty/);
    expect(() => validateTasks({ sequences: [{ id: 's', cluster: 'c', repo: 'r', tasks: [{ id: 't' }] }] })).toThrow(/at least 2 tasks/);
  });

  it('counterbalances hippo and no-memory order across seeds and runs dependent arms after hippo', () => {
    const s = { sequences: [{ id: 's', tasks: [] }] };
    const order = (seed: number) => planRuns(s, ['no-memory', 'hippo', 'random-text', 'stale-memory'], 2)
      .filter((r: { seed: number }) => r.seed === seed).map((r: { arm: string }) => r.arm);
    expect(order(1)).toEqual(['hippo', 'no-memory', 'random-text', 'stale-memory']);
    expect(order(2)).toEqual(['no-memory', 'hippo', 'random-text', 'stale-memory']);
  });

  it('reads usage from modelUsage, not the top-level usage that can read zero', () => {
    const u = usageFromResult({
      usage: { input_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 0 },
      modelUsage: { a: { inputTokens: 10, outputTokens: 5, cacheReadInputTokens: 100, cacheCreationInputTokens: 20 }, b: { inputTokens: 1, outputTokens: 1, cacheReadInputTokens: 1, cacheCreationInputTokens: 1 } },
    });
    expect(u).toEqual({ inputTokens: 11, cacheWriteTokens: 21, cacheReadTokens: 101, outputTokens: 6 });
  });

  it('runs every arm, grades with hidden tests, records usage, work and hippo ledger rows', () => {
    const { repo, base, fix } = makeRepo();
    const out = mkdtempSync(join(tmpdir(), 'ab-run-out-'));
    const projects = mkdtempSync(join(tmpdir(), 'ab-run-projects-'));
    dirs.push(out, projects);
    const prevProjects = process.env.FAKE_CLAUDE_PROJECTS;
    process.env.FAKE_CLAUDE_PROJECTS = projects;
    try {
      runAll({
        spec: spec(repo, base, fix),
        arms: ['no-memory', 'hippo', 'random-text', 'stale-memory'],
        seeds: 1,
        outDir: out,
        model: null,
        claudeBin: `"${process.execPath}" "${FAKE}"`,
        projectsDir: projects,
        settleMs: 0,
        warmup: false,
        log: () => {},
      });
    } finally {
      if (prevProjects === undefined) delete process.env.FAKE_CLAUDE_PROJECTS;
      else process.env.FAKE_CLAUDE_PROJECTS = prevProjects;
    }

    const records = readFileSync(join(out, 'runs.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    expect(records).toHaveLength(4 * 5);
    const get = (arm: string, taskId: string) => records.find((r) => r.arm === arm && r.taskId === taskId);

    // Hidden-test grading: FIX prompts pass, the look-around task fails.
    expect(get('no-memory', 'a1').resolved).toBe(true);
    expect(get('no-memory', 'a3').resolved).toBe(false);
    expect(get('no-memory', 'a1').scored).toBe(false);
    expect(get('no-memory', 'a2').scored).toBe(true);

    // Usage and work come from the result and the transcript.
    expect(get('hippo', 'a2').usage.cacheReadTokens).toBe(10000);
    expect(get('hippo', 'a2')).toMatchObject({ toolCalls: 2, fileReads: 1, transcriptFound: true });
    // The same error signature in a later task of the sequence counts as repeated.
    expect(get('no-memory', 'a1').repeatedErrors).toBe(0);
    expect(get('no-memory', 'a2').repeatedErrors).toBe(1);

    // hippo arm: the lesson from a1 is injected on a2 and recorded in the ledger.
    expect(get('hippo', 'a1').hippo.sent).toBe(0);
    expect(get('hippo', 'a2').hippo.sent).toBeGreaterThan(0);
    expect(get('no-memory', 'a2').hippo).toBeNull();
    // stale-memory reuses the other repository's finished hippo store.
    expect(get('stale-memory', 'b2').hippo.sent).toBeGreaterThan(0);
    // random-text injects text too (counted in the stand-in's cache writes).
    expect(get('random-text', 'a2').usage.cacheWriteTokens).toBeGreaterThan(2000);

    // No future: the workspace history ends at the task's base, never the fix.
    const log = execFileSync('git', ['log', '--all', '--format=%H'], { cwd: join(out, 'work', 'seqA', 'hippo', 'seed1'), encoding: 'utf8' });
    expect(log).toContain(base);
    expect(log).not.toContain(fix);

    // Isolation: no-memory has no hippo store; the hippo arm's store is excluded from git.
    expect(existsSync(join(out, 'work', 'seqA', 'no-memory', 'seed1', '.hippo'))).toBe(false);
    expect(execFileSync('git', ['status', '--porcelain'], { cwd: join(out, 'work', 'seqA', 'hippo', 'seed1'), encoding: 'utf8' })).not.toContain('.hippo');

    // The analyzer reads the records directly.
    const result = analyze(parseRuns(readFileSync(join(out, 'runs.jsonl'), 'utf8')));
    expect(result.excluded.unscored).toBe(8);
    expect(result.comparisons.map((c: { arm: string }) => c.arm).sort()).toEqual(['hippo', 'random-text', 'stale-memory']);
  }, 180_000);
});
