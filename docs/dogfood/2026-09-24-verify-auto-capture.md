# Verify automatic capture on your own machine

**Why:** automatic capture only runs if the hooks are actually installed where Claude Code reads them. A real `/compact` in a sandbox on 2026-09-24 confirmed the mechanism. Your machine has not been checked. An older install, or a project without `CLAUDE.md`, can be missing hooks.

Run these in a project where you use Claude Code (PowerShell or a terminal). Hippo must include the 2026-09-24 changes (PR #227).

## 1. Hooks installed?

```bash
hippo doctor
```

The `claude-code` line should read "all hippo hooks installed, including compaction and failed-tool capture" or "hippo plugin enabled". If it lists missing hooks, run:

```bash
hippo hook install claude-code
```

This adds only what is missing, and is safe to re-run.

## 2. Compaction capture works?

1. Start `claude` in the project and have a short conversation that states a rule plainly, for example:
   > "Never run npm install here; this repo uses pnpm."
2. Type `/compact`.
3. Check what hippo did:

```bash
# Windows: %USERPROFILE%\.hippo\logs\pre-compact.log
tail -5 ~/.hippo/logs/pre-compact.log
hippo snapshot show            # the task, summary and next step saved at compaction
hippo recall "pnpm npm install" --budget 500
```

**Expect:**
- the log says `snapshot saved` and `capture: N items captured`;
- `snapshot show` prints the task;
- recall finds the rule.

**Known limit:** capture is rule-based, with no AI model. A rule phrased as "we use pnpm, never npm, because…" can be missed. The sandbox run missed exactly that one. Write down what it misses.

## 3. Failed-tool capture works?

In Claude Code, ask the agent to run a command that fails for a real reason, for example a build with a missing module. Then:

```bash
hippo recall "Cannot find module" --budget 500
```

The failure should be stored once, tagged `error` and `auto-captured`.

It should **not** be stored when:
- you interrupt the agent;
- you decline a permission;
- a search finds nothing.

## 4. Report back

Record:
- what `hippo doctor` said;
- the last lines of `pre-compact.log`;
- whether recall found the rule and the error.

Put these in `docs/dogfood/` or a PR comment. The roadmap's 90-day queue item "verify automatic capture on the founder's machine" closes when this is done.
