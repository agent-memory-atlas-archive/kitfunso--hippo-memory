/**
 * TE5 task drafting from git history: candidate selection, the fail-at-base
 * and pass-at-fix check, and the needsReview gate the runner enforces.
 * Real git repository, real worktrees.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { findCandidates, verifyCandidate, draftTasks } from '../scripts/token-eval/make-tasks.mjs';
import { validateTasks } from '../scripts/token-eval/ab-run.mjs';

const dirs: string[] = [];
afterEach(() => { while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true }); });

function repoWithHistory(): string {
  const repo = mkdtempSync(join(tmpdir(), 'make-tasks-'));
  dirs.push(repo);
  const git = (...a: string[]): void => { execFileSync('git', a, { cwd: repo, stdio: 'ignore' }); };
  git('init', '-q');
  git('config', 'user.email', 't@e');
  git('config', 'user.name', 'T');
  git('config', 'commit.gpgsign', 'false');
  mkdirSync(join(repo, 'tests'));
  writeFileSync(join(repo, 'lib.js'), 'module.exports.add = (a, b) => a - b;\n');
  git('add', '.');
  git('commit', '-qm', 'initial');
  // A real fix with a test that fails before it.
  writeFileSync(join(repo, 'lib.js'), 'module.exports.add = (a, b) => a + b;\n');
  writeFileSync(join(repo, 'tests', 'add.test.js'), "if (require('../lib.js').add(2, 3) !== 5) process.exit(1);\n");
  git('add', '.');
  git('commit', '-qm', 'fix: add returned a difference');
  // Docs only: not a candidate.
  writeFileSync(join(repo, 'README.md'), 'docs\n');
  git('add', '.');
  git('commit', '-qm', 'docs');
  // Code plus a test that already passed before: a candidate that verify drops.
  writeFileSync(join(repo, 'lib.js'), 'module.exports.add = (a, b) => a + b;\nmodule.exports.one = 1;\n');
  writeFileSync(join(repo, 'tests', 'one.test.js'), "if (require('../lib.js').add(1, 1) !== 2) process.exit(1);\n");
  git('add', '.');
  git('commit', '-qm', 'feat: export one');
  return repo;
}

describe('make-tasks (TE5)', () => {
  it('picks commits that change code and tests, and verify keeps only real fixes', () => {
    const repo = repoWithHistory();
    const candidates = findCandidates(repo);
    expect(candidates.map((c: { subject: string }) => c.subject)).toEqual(['fix: add returned a difference', 'feat: export one']);
    expect(candidates[0].testFiles).toEqual(['tests/add.test.js']);

    const cmd = 'node {files}';
    expect(verifyCandidate(repo, candidates[0], cmd, null)).toEqual({ failsAtBase: true, passesAtFix: true });
    expect(verifyCandidate(repo, candidates[1], cmd, null)).toEqual({ failsAtBase: false, passesAtFix: true });
  });

  it('drafts tasks that the runner refuses until reviewed', () => {
    const repo = repoWithHistory();
    const tasks = draftTasks(findCandidates(repo), { repo, cluster: 'demo', testCmd: 'node {files}', perSequence: 5 });
    expect(tasks.sequences).toHaveLength(1);
    expect(tasks.sequences[0].tasks[0]).toMatchObject({ needsReview: true, test: 'node tests/add.test.js' });
    expect(() => validateTasks(tasks)).toThrow(/needsReview/);
    for (const t of tasks.sequences[0].tasks) delete t.needsReview;
    expect(() => validateTasks(tasks)).not.toThrow();
  });
});
