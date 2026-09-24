# Security policy

## Reporting a vulnerability

Please do not open a public issue for a security problem.

Report it privately through GitHub: on the repository's **Security** tab, choose **Report a vulnerability** (GitHub private vulnerability reporting). Include:

- the hippo-memory version (`hippo --version`) and how you run it (CLI, MCP server, HTTP server, plugin);
- the steps to reproduce, and what an attacker gains;
- whether the issue is already public.

You should get an acknowledgement within 3 working days and an assessment within 10. Fixes ship as a patch release, with credit in the changelog unless you ask otherwise.

## Supported versions

| Version | Supported |
|---|---|
| The current `stable` npm tag | Yes |
| The current `latest` npm tag | Yes |
| Anything older | No: upgrade to `stable` |

## Scope

In scope:
- the `hippo` CLI and its hooks;
- the MCP server (`hippo mcp`);
- the HTTP server (`hippo serve`), its API keys and tenant isolation;
- the connectors;
- the agent plugins in `extensions/`.

Especially relevant:
- one tenant, scope or API key reading another's memories;
- secrets reaching a memory, a log or an outside API unredacted;
- a hook that runs attacker-controlled input;
- anything that deletes memories without the caller's authority.

Out of scope:
- attacks that need an attacker who already controls the machine or the `.hippo` directory;
- denial of service on a server bound to loopback.

## Verifying a release

Releases from 1.46.0 on are published from GitHub Actions with npm provenance. `npm audit signatures` in a project that depends on hippo-memory checks them, and the npm package page links each version to the commit and workflow run that built it.
