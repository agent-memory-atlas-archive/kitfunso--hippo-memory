#!/usr/bin/env node
/**
 * UserPromptSubmit hook for the `random-text` control arm of the TE5 A/B
 * (docs/evals/2026-09-23-te5-token-ab-preregistration.md): injects random
 * lines of the repository's own tracked files, about as many tokens as hippo
 * injects per prompt, so a gain can be attributed to hippo's selection
 * rather than to extra context. Seeded: EVAL_SEED plus the prompt count
 * give the same text on a rerun.
 *
 * Usage (as a hook command): node random-text-hook.mjs --tokens 300
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';

import { seededRandom } from '../../dist/eval-stats.js';
import { estimateTokens } from '../../dist/token-ledger.js';

const i = process.argv.indexOf('--tokens');
const target = i >= 0 ? Number(process.argv[i + 1]) : 300;
const counterFile = path.join(process.cwd(), '.git', 'random-text-hook-count');
let count = 0;
try {
  count = Number(fs.readFileSync(counterFile, 'utf8')) || 0;
} catch {
  count = 0;
}
fs.writeFileSync(counterFile, String(count + 1));

const rand = seededRandom((Number(process.env.EVAL_SEED) || 1) * 100_003 + count);
let files = [];
try {
  files = execFileSync('git', ['ls-files'], { encoding: 'utf8' }).split('\n').filter((f) => /\.(ts|js|mjs|py|md|json|go|rs|java)$/.test(f));
} catch {
  files = [];
}
const lines = [];
let tokens = 0;
for (let attempts = 0; tokens < target && attempts < 200 && files.length > 0; attempts++) {
  const file = files[Math.floor(rand() * files.length)];
  let text;
  try {
    text = fs.readFileSync(file, 'utf8').split('\n');
  } catch {
    continue;
  }
  if (text.length === 0) continue;
  const start = Math.floor(rand() * text.length);
  const chunk = text.slice(start, start + 8).join('\n').trim();
  if (!chunk) continue;
  lines.push(`- ${file}: ${chunk}`);
  tokens += estimateTokens(chunk);
}
if (lines.length > 0) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'UserPromptSubmit',
      additionalContext: `## Repository notes\n\n${lines.join('\n')}`,
    },
  }));
}
