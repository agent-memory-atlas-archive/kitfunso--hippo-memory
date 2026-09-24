#!/usr/bin/env node
/**
 * Draft a TE5 tasks file from a repository's own history (ROADMAP Part IX).
 *
 * A candidate task is a non-merge commit that changes at least one test file
 * and at least one non-test file: its parent is the task's base, the commit
 * is the fix, and the test files it adds or changes are the hidden tests.
 * Consecutive candidates are grouped into sequences, so later tasks can use
 * what earlier ones taught.
 *
 * Every drafted task has `needsReview: true` and a prompt that is only the
 * commit subject and body. Commit messages usually describe the fix, which
 * leaks the answer; rewrite each prompt as the problem a user would report
 * (symptom, not solution), then delete `needsReview`. ab-run.mjs refuses
 * tasks that still carry it.
 *
 * --verify checks each candidate in a scratch worktree: the hidden tests must
 * fail at the base and pass at the fix, or the task cannot tell a fix from
 * no fix. Candidates that fail the check are dropped and listed.
 *
 * Run:
 *   node scripts/token-eval/make-tasks.mjs --repo ../some-repo --cluster some-repo \
 *     --test-cmd "npx vitest run {files}" --setup "npm ci && npm run build" \
 *     [--since 2026-01-01] [--max 40] [--per-sequence 5] [--verify] > tasks.json
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const DEFAULT_TEST_PATTERN = '(^|/)(tests?|__tests__|spec)/|\\.(test|spec)\\.[cm]?[jt]sx?$|_test\\.(py|go)$|(^|/)test_[^/]*\\.py$';

function git(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 1 << 28 }).trim();
}

/** Candidate commits, oldest first. */
export function findCandidates(repo, { since = null, max = 40, testPattern = DEFAULT_TEST_PATTERN } = {}) {
  const re = new RegExp(testPattern);
  const args = ['log', '--no-merges', '--reverse', '--format=%H%x09%P'];
  if (since) args.push(`--since=${since}`);
  const out = git(args, repo);
  const candidates = [];
  for (const line of out ? out.split('\n') : []) {
    const [sha, parents] = line.split('\t');
    const parentList = (parents ?? '').split(' ').filter(Boolean);
    if (parentList.length !== 1) continue;
    const changed = git(['diff', '--name-only', '--diff-filter=AM', parentList[0], sha], repo).split('\n').filter(Boolean);
    const tests = changed.filter((f) => re.test(f));
    const code = git(['diff', '--name-only', parentList[0], sha], repo).split('\n').filter((f) => f && !re.test(f));
    if (tests.length === 0 || code.length === 0) continue;
    candidates.push({
      sha,
      parent: parentList[0],
      testFiles: tests,
      subject: git(['log', '-1', '--format=%s', sha], repo),
      body: git(['log', '-1', '--format=%b', sha], repo),
    });
  }
  return candidates.slice(-max);
}

/** Hidden tests fail at the base and pass at the fix, checked in a scratch worktree. */
export function verifyCandidate(repo, c, testCmd, setup) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hippo-task-verify-'));
  const cmd = testCmd.replace('{files}', c.testFiles.join(' '));
  try {
    git(['worktree', 'add', '--quiet', '--detach', dir, c.parent], repo);
    for (const f of c.testFiles) {
      fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
      fs.writeFileSync(path.join(dir, f), execFileSync('git', ['show', `${c.sha}:${f}`], { cwd: repo, maxBuffer: 1 << 28 }));
    }
    const run = (c2) => spawnSync(c2, { cwd: dir, shell: true, encoding: 'utf8', timeout: 20 * 60_000 }).status;
    if (setup) run(setup);
    const atBase = run(cmd);
    git(['checkout', '--quiet', '-f', c.sha], dir);
    if (setup) run(setup);
    const atFix = run(cmd);
    return { failsAtBase: atBase !== 0, passesAtFix: atFix === 0 };
  } finally {
    try {
      git(['worktree', 'remove', '--force', dir], repo);
    } catch {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
}

/** Group candidates into sequences and emit the tasks-file object. */
export function draftTasks(candidates, { repo, cluster, testCmd, setup = null, perSequence = 5 }) {
  const sequences = [];
  for (let i = 0; i + 1 < candidates.length; i += perSequence) {
    const chunk = candidates.slice(i, i + perSequence);
    if (chunk.length < 2) break;
    sequences.push({
      id: `${cluster}-${sequences.length + 1}`,
      cluster,
      repo,
      tasks: chunk.map((c) => {
        const task = {
          id: c.sha.slice(0, 10),
          baseRef: c.parent,
          fixRef: c.sha,
          needsReview: true,
          prompt: `${c.subject}\n\n${c.body}`.trim(),
          testFiles: c.testFiles,
          test: testCmd.replace('{files}', c.testFiles.join(' ')),
        };
        if (setup) task.setup = setup;
        return task;
      }),
    });
  }
  return { sequences };
}

function main() {
  const argv = process.argv;
  const flag = (name, fallback) => {
    const i = argv.indexOf(name);
    return i >= 0 && i + 1 < argv.length ? argv[i + 1] : fallback;
  };
  const repo = flag('--repo', null);
  const testCmd = flag('--test-cmd', null);
  if (!repo || !testCmd) {
    console.error('Usage: node scripts/token-eval/make-tasks.mjs --repo PATH --cluster NAME --test-cmd "cmd {files}" [--setup CMD] [--since DATE] [--max 40] [--per-sequence 5] [--verify]');
    process.exit(1);
  }
  const repoPath = path.resolve(repo);
  const cluster = flag('--cluster', path.basename(repoPath));
  const setup = flag('--setup', null);
  let candidates = findCandidates(repoPath, {
    since: flag('--since', null),
    max: Number(flag('--max', '40')),
    testPattern: flag('--test-pattern', DEFAULT_TEST_PATTERN),
  });
  if (argv.includes('--verify')) {
    const kept = [];
    for (const c of candidates) {
      const v = verifyCandidate(repoPath, c, testCmd, setup);
      if (v.failsAtBase && v.passesAtFix) kept.push(c);
      else console.error(`dropped ${c.sha.slice(0, 10)} (${c.subject}): fails at base ${v.failsAtBase}, passes at fix ${v.passesAtFix}`);
    }
    candidates = kept;
  }
  const tasks = draftTasks(candidates, { repo: repoPath, cluster, testCmd, setup, perSequence: Number(flag('--per-sequence', '5')) });
  console.error(`${candidates.length} candidate tasks in ${tasks.sequences.length} sequences. Every prompt needs review: rewrite it as the problem, not the fix, then delete "needsReview".`);
  console.log(JSON.stringify(tasks, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
