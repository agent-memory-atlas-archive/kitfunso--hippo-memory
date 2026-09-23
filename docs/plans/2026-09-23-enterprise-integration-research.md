# Enterprise integration research: how companies store code and run DevOps, and how hippo plugs in

Date: 2026-09-23. Status: research, feeds ROADMAP Part VIII (Track EI). No code changes.

Method: three parallel research passes (market and platform landscape from vendor docs,
surveys and filings; a literature review of MSR, repository-context and agent-memory
papers; a read-only audit of hippo's own integration surface at v1.44.0). Web pages were
read through search summaries because the sandbox proxy blocked most direct fetches, so
figures marked *secondary* come from write-ups, not primary pages, and every figure should
be re-checked before it goes on a slide. arXiv items from 2026 are preprints.

## Bottom line

1. **Most companies do not keep code "somewhere exotic". They keep it in Git, hosted where
   their security team is comfortable.** Git is on ~94% of professional machines
   (*secondary*). The hosts are GitHub (Cloud, Enterprise Cloud with data residency, or
   self-hosted Enterprise Server), GitLab (about two thirds of GitLab's revenue is still
   self-managed), Bitbucket Data Center, and Azure DevOps. Industry outliers are real but
   narrow: Perforce in games and hardware, Gerrit in Android-based automotive and embedded.
2. **Hippo's git learning already works on every Git host**, because it reads the local
   clone with `git log`, not a host API. What it cannot see today is everything *around*
   the code: pull request reviews, tickets, incidents, CI failures, chat decisions. That
   metadata lives behind each host's API, and that is where the enterprise integration work is.
3. **Four things decide whether an enterprise can adopt a memory layer at all**, and hippo
   has one of them:
   - deployment where their code already lives (SaaS, single-tenant VPC, air-gapped);
   - identity (SSO, SCIM, machine identity instead of long-lived tokens);
   - **permission-aware recall**: a lesson learned from a private repo must never reach
     someone who cannot read that repo;
   - an audit trail. Hippo has the audit trail and tenant isolation. SSO/SCIM are stubs,
     there is no Postgres or Helm story, and recall does not check the caller's source
     permissions.
4. **The research literature backs hippo's thesis with a condition.** Memory helps coding
   agents when it holds knowledge the repository cannot tell them (tribal conventions,
   past incidents) and when it is short and precisely retrieved. Bulk or unverified context
   can hurt. That is a design brief for the enterprise product, and a benchmark gap hippo
   can own.
5. **The plan in one line:** one core, many source adapters, a per-company profile learned
   from the company's own history, delivered to every agent over MCP, deployed wherever the
   company's code is allowed to live.

## 1. Where enterprises keep code

| Host | Deployment options | Where it dominates | Integration notes |
|---|---|---|---|
| **GitHub** | github.com, Enterprise Cloud (EMU accounts owned by the IdP), Enterprise Cloud with data residency on `*.ghe.com` (EU, Australia, US GA May 2025, Japan GA Dec 2025), Enterprise Server (self-hosted) | Default for most companies: ~81% of developers use it (Stack Overflow 2025, *secondary*), 90% of the Fortune 100 (*secondary*) | GitHub App with installation tokens is the enterprise-expected auth. API base URL differs on ghe.com and GHES. GHES supports only local MCP servers. |
| **GitLab** | GitLab.com, Dedicated (single-tenant SaaS, FedRAMP Moderate for government since May 2025), self-managed | ~36% of developers (SO 2025, *secondary*). FY26 revenue $955M, SaaS only ~32% of it: self-hosting is mainstream | Group service accounts or OAuth, group webhooks, instance-wide system hooks on self-managed. Must work behind the firewall. |
| **Bitbucket** | Cloud, Data Center | Atlassian-heavy and regulated shops (300K+ Atlassian customers, 80%+ of the Fortune 500) | Bitbucket DC is exempt from Atlassian's 2029 Data Center end of life. Cloud app passwords stop working June 2026; use API tokens. |
| **Azure DevOps** | Services (SaaS), Server (on-prem, ex-TFS; went "versionless" Dec 2025) | Microsoft and .NET enterprises, government | Entra ID service principals or managed identity only: new ADO OAuth apps stopped April 2025 and global PATs stop working Dec 1, 2026. Microsoft steers new AI work to GitHub. |
| **AWS CodeCommit** | AWS | AWS-only regulated shops | Closed to new customers in 2024, back to full GA Nov 2025. Niche. |
| **Google** | Secure Source Manager (Cloud Source Repositories closed to new customers 2024) | Rare | Google's real path is Developer Connect, which links GitHub, GitLab and Bitbucket, including self-hosted. |
| **Gerrit** | Self-hosted | Android, Chromium, automotive and embedded (e.g. Automotive Grade Linux) | Review unit is a *change* with patch sets and votes, not a pull request. |
| **Perforce P4** (ex-Helix Core) | Self-hosted, cloud | AAA games, VFX, chips and hardware (vendor claims 19 of the top 20 AAA studios); ISO 26262 certified | Not Git. Usually hybrid: P4 for binaries, Git for code. |
| Long tail | SVN, Unity VCS (Plastic), Gitea/Forgejo | Legacy codebases, Unity studios, European public sector | Low priority. |

**Industry patterns.**
- **Finance, defense and government:** self-hosted GHES or GitLab, Bitbucket DC, Azure
  DevOps Server. They need air gaps, FedRAMP and data residency.
- **Games and hardware:** Perforce plus Git.
- **Automotive and embedded:** Gerrit with manifest-based multi-repo.
- **Big tech:** monorepos (Google Piper, Meta Sapling, Microsoft Scalar, Uber's Go
  monorepo at 1,000+ commits a day). One repo is not one project there, so memory must be
  scoped by path and owner, not just by repo.

**How repos are maintained.**
- Trunk-based development is the DORA-recommended norm; GitFlow survives in release-train
  and regulated shops.
- Reviews happen as pull requests or merge requests (Gerrit: changes, Perforce: Swarm reviews).
- Governance lives in CODEOWNERS, branch protection and rulesets, signed commits, merge
  queues and merge trains. Stacked diffs are growing (Graphite, now owned by Cursor).
- Conventional Commits are common but not universal. **Jira keys in commit and branch names
  (`ABC-123`) are the cheapest join between code and tickets**, and hippo should parse them.
- DORA 2025 found AI adoption at 90% and linked it to higher throughput *and* higher delivery
  instability. Lessons from reverts and incidents are exactly the memory that addresses that.

## 2. The toolchain around the code

| Category | What enterprises run | What it gives a memory layer |
|---|---|---|
| CI/CD | GitHub Actions 33%, Jenkins 28%, GitLab CI 19% of orgs (JetBrains 2025); 41% run two or more CI tools. Argo CD in ~60% of Kubernetes clusters (CNCF 2025) | Failure logs and flaky-test history as "this breaks when..." lessons |
| Issues | Jira (dominant, ~46% SO 2025 *secondary*), Azure Boards, GitHub Issues, Linear, ServiceNow | The *why* behind a change; join to code through ticket keys |
| Incidents | PagerDuty (35K+ customers), Jira Service Management (absorbing Opsgenie, which shuts down April 2027), incident.io, ServiceNow | Postmortems: the highest-value lesson source there is |
| Observability | Datadog (48% of the Fortune 500), Grafana/Prometheus, Splunk | Alert-to-cause links (later phase) |
| Docs | Confluence, SharePoint/Loop, Notion, Backstage TechDocs, ADRs in the repo | Decisions and conventions |
| Chat | Microsoft Teams (320M MAU) at least as common as Slack in enterprise | Decisions made in threads; hippo has Slack only |
| Developer portals | Backstage (3,400+ adopters), Port, Cortex | **A ready-made ownership graph** (`catalog-info.yaml`: service, owner, system) to scope memories to teams |

## 3. What an enterprise requires before it lets an AI tool near its code

- **Deployment choice.** Multi-tenant SaaS with EU/US residency, single-tenant or
  customer-VPC (Helm, Terraform), and fully air-gapped with local embeddings and a pluggable
  model endpoint (Bedrock, Azure OpenAI, Vertex, vLLM). Tabnine, JetBrains and Augment all
  sell air-gapped. Hippo's local-first SQLite core is an advantage here; server mode needs
  Postgres for high availability.
- **Identity.**
  - SAML or OIDC SSO, and SCIM 2.0 provisioning.
  - Roles mapped to IdP groups.
  - Machine identity: GitHub Apps, GitLab service accounts, Entra service principals,
    OIDC workload identity federation. Long-lived personal tokens are being killed across
    the industry: Azure DevOps global PATs and Bitbucket app passwords both end in 2026.
- **Permission-aware retrieval.** Glean, Atlassian Rovo and Sourcegraph all mirror source
  permissions and enforce them per user at query time. A 2026 study found retrieval
  without an authorization gate leaked across tenants in 98-100% of probes
  (arXiv:2605.05287). **This is the largest gap between hippo today and an enterprise sale.**
- **Data controls.**
  - Zero-retention model calls, and no training on customer data (contractual).
  - Secret and PII scanning before storage.
  - Retention policies, legal hold, and export/delete for data-subject requests.
  - Customer-managed keys.
- **Network.**
  - Published egress IPs, IP allowlisting, private endpoints.
  - An **outbound-only relay** so a self-hosted Git server never needs an inbound hole.
- **Governance.**
  - An immutable audit log exportable to a SIEM.
  - Per-source and per-repo opt-out.
  - Listing in the company's internal **MCP registry**: GitHub Copilot admins can already
    enforce "registry only" MCP allowlists in VS Code and JetBrains.
- **Paperwork.**
  - SOC 2 Type II first, then ISO 27001 and increasingly ISO 42001.
  - A vendor questionnaire (SIG or CAIQ), DPA and subprocessor list.
  - A HIPAA BAA on request.
  - FedRAMP only through a self-hosted SKU or a partner.

## 4. The competitive bar

| Tool | Code hosts | Deployment | Permissions |
|---|---|---|---|
| GitHub Copilot Enterprise | GitHub only (knowledge bases retired Nov 2025, replaced by Copilot Spaces) | SaaS; US/EU residency and FedRAMP models since April 2026 | GitHub's own |
| Sourcegraph | GitHub, GitLab, Bitbucket, Gerrit, Perforce, Azure DevOps | Self-hosted or single-tenant | Synced from hosts |
| Atlassian Rovo | GitHub, GitLab, Azure DevOps, Bitbucket, Slack, Teams via Teamwork Graph | Atlassian Cloud | Respects source permissions |
| Glean | 100+ connectors incl. GitHub, GitLab, Jira | SaaS or customer cloud | Enforced at query time |
| Augment Code | GitHub, GitLab, Bitbucket; its context engine is sold **over MCP** to other agents | SaaS, air-gapped claimed | SOC 2, ISO 42001 |
| Cursor, Devin/Windsurf | GitHub, GitLab, Azure DevOps, Bitbucket | SaaS, self-hosted workers, customer VPC | Via host apps |
| Tabnine, JetBrains AI | Git hosts / IDE | On-prem and air-gapped | Zero retention |

Every serious neutral vendor covers GitHub, GitLab, Bitbucket and Azure DevOps, including
self-hosted editions. **Nobody owns "lessons the organisation learned, with provenance,
that decay and get corrected over time" as a separate layer.** The closest encroachers are
Augment's context engine, Copilot Spaces and Rovo's Teamwork Graph. All three are
retrieval over current state, and none of them manages a memory lifecycle.

## 5. What the research literature says

**Memory helps coding agents under specific conditions:**
- **Subtask-level memory:** +4.7 points on SWE-bench Verified (arXiv:2602.21611).
- **Learning from successes and failures:** ReasoningBank gains on SWE-Bench-Verified (arXiv:2509.25140).
- **Compact summaries of prior tasks:** they lower cost and runtime, and ~200-token
  summaries beat ~25k-token trajectories (SWE Context Bench, arXiv:2602.08316).
- **Human-written repo instructions:** AGENTS.md cut median runtime ~29% (arXiv:2601.20404).
- **Replaying a repository's own history:** an agent that attempts historical issues blind
  and learns from the gap to the real merged diff writes PRs that fit the codebase better
  (Learning to Commit, arXiv:2603.26664). **This is the closest published analogue to what
  hippo's git learning should become.**

**It can also hurt:**
- **Unverified context:** LLM-generated context files lowered success ~3% and raised cost
  20%+ (arXiv:2602.11988).
- **No gain at equal budget:** memory modules often lose their edge when the baseline gets
  the same token budget (arXiv:2606.15017).
- **Simple storage is a strong baseline:** verbatim storage scores well on multi-session
  benchmarks (DreamBench-SWE, arXiv:2608.20664).

The consistent reading: **store knowledge the repo cannot tell the agent, keep it short,
retrieve it precisely, and prove value on a budget-matched benchmark.**

**Mining software repositories gives better tools than keyword matching:**
- **Commit classification** that reads the diff, not just the subject (Levin & Yehudai 2017).
- **Filtering** of tangled commits and bot commits.
- **SZZ** links a fix back to the change that introduced the bug (Śliwerski et al. 2005;
  R-SZZ best precision in Rosa et al. 2021; LLM4SZZ 2025). It turns "bug X was fixed" into
  "changing Y in file Z caused X".
- **Co-change mining** (Zimmermann et al. 2005) surfaces lessons attached to files that
  historically change together. That targets the multi-file edits agents miss.
- **Review threads** that ended in a code change encode team conventions (Bacchelli & Bird 2013).
- **TODO/FIXME/hack comments** mark known hazards (Potdar & Shihab 2014).

**Organizational memory.**
- Groups remember through a shared directory of who knows what (transactive memory,
  Wegner 1987), not by everyone storing everything.
- With AI writing more code, `git blame` authorship no longer tells you who understands it
  (arXiv:2606.20882). Hippo's outcome feedback, retrieval logs and review participation are
  better evidence.

**Security.** Memory writes are an attack surface: memory injection succeeds 95%+ of the
time in the MINJA work (arXiv:2503.03704). Trust should follow provenance: a reviewed PR
beats a Slack message, which beats an agent's own reflection.

**The open gap hippo can own:** the 2025-2026 benchmarks that test memory across coding
tasks (SWE-Bench-CL, SWE Context Bench, DreamBench-SWE) do not draw on proprietary
organisational history: PR reviews, incidents, ticket decisions. An **organisational-memory
benchmark for coding agents** is publishable, and it is the proof metric enterprises
will ask for.

## 6. Where hippo stands today (read from source, v1.44.0)

| Area | State | Gap |
|---|---|---|
| Git learning | Host-agnostic: runs `git log --since --pretty=%s` on local clones (`src/autolearn.ts:189`). Invalidation from migration commits (`src/invalidation.ts`). | Subject line only. No body, trailers, author, files, diff, ticket keys, or bot filtering. Lessons carry no `artifact_ref`, so they cannot be traced to a commit. The CLI ignores `config.gitLearnPatterns` (`src/cli.ts:6980`); MCP honours it. |
| Connectors | Slack and GitHub webhooks with HMAC checks, idempotency, DLQ, backfill, deletion, tenant routing | Two copy-pasted modules, no shared interface. About 1,000-1,400 source lines per connector today, or 300-500 with a shared kit. GitHub backfill hardcodes `https://api.github.com` (no GHES). `artifact_ref` has no host part. No GitHub App auth. No CLI to register GitHub routing. |
| Server | API keys (scrypt), admin/member roles, tenants, per-IP rate limit, audit log, non-loopback bind gated by `HIPPO_REQUIRE_AUTH` | **A member key can mint an admin key** (`src/server.ts:1262-1268`, noted in code). Plain HTTP only. No per-key quotas. |
| Identity | `src/sso.ts` stubs throw `NotImplementedError` | SSO, SCIM, IdP groups, machine identity |
| Permissions | Tenant isolation; default-deny on `<source>:private:` scopes | Any key in a tenant can read a private scope by naming it. No per-user ACLs, no identity mapping to source permissions, no ACL re-sync. |
| Storage and deploy | SQLite; `deploy/aml` Docker is a benchmark deployment | No Postgres (A6), Helm, encryption at rest, data residency or air-gapped packaging |
| Agent delivery | MCP (13 tools), hooks for 6 agents, HTTP API, Python SDK | Not yet listed for enterprise MCP registries |

## 7. How hippo plugs into any company: one core, many adapters, one company profile

The product promise stays the same: **one memory layer behind every agent.** The
enterprise version adds four layers around the unchanged core.

1. **Source adapters (connector kit).**
   - **What an adapter does:** turns each system (GitHub, GitLab, Bitbucket, Azure DevOps,
     Jira, Confluence, Teams, Slack, PagerDuty) into one normalized event stream. Each event
     carries content, `kind`, `owner`, a host-qualified `artifact_ref`
     (e.g. `gitlab://git.corp.example/group/repo/mr/42`) and an **ACL** (who may read it).
   - **Shared machinery:** idempotency, dead-letter queue, cursors, tenant routing and backfill
     live in one kit. A new source is then an adapter of a few hundred lines.
   - **The core never needs to know** whether an event came from GitLab or Azure DevOps.
2. **Git learning v2, the part that already works everywhere.**
   - **Read more of each commit:** subject, body, trailers (`Fixes`, `Co-authored-by`),
     ticket keys, changed paths and author.
   - **Filter noise:** bot and tangled commits.
   - **Link causes (SZZ-lite):** connect fixes and reverts back to the change that caused
     them, and store the commit as the lesson's `artifact_ref`.
   - **Stay host-agnostic:** it runs on the local clone, so every Git host works on day one,
     self-hosted and air-gapped included. Perforce and Gerrit follow through Git bridges.
3. **A company profile, the per-company tailoring.** Each company differs in sources, repos,
   conventions and sensitivity. The profile holds:
   - **Declared:** which sources and repos; the ticket-key pattern; commit conventions;
     ownership from CODEOWNERS or a Backstage catalog; retention and legal hold;
     sensitivity rules and opt-outs (`.hippoignore`); the model endpoint.
   - **Learned at onboarding, by hindcast:** replay a sample of the company's own past
     issues, compare an agent's attempt to the real merged change, and store the
     differences as convention memories. This follows the Learning-to-Commit approach, and
     every lesson is grounded in evidence rather than generated unchecked.
   - **Learned over time:** a per-tenant memory-value scorer (LC2/LC3) trained on that
     company's own outcomes and dormant restores. It stays per tenant and deletable, never
     pooled across customers.
4. **Deployment that matches the company's posture.**
   - **Hosted:** SaaS with EU/US regions.
   - **Customer-hosted:** single-tenant or customer VPC (Helm/Terraform, Postgres).
   - **Air-gapped:** fully offline, with local embeddings and the customer's own model endpoint.
   - **Self-hosted Git servers:** an outbound-only relay agent, so they never open an
     inbound port.

Agents keep getting memory the same way: MCP, hooks and the HTTP API. Permission-aware
recall checks the calling user's identity against each memory's ACL *before* ranking.
Memories derived from several sources inherit the most restrictive ACL.

## 8. Recommended order (becomes ROADMAP Part VIII)

1. **Unblock trust first:**
   - permission-aware recall;
   - fix the member-mints-admin key bug;
   - the connector kit;
   - Git learning v2;
   - a budget-matched evaluation harness that replays a tenant's own history, so every
     later claim is measured.
2. **Cover the market:**
   - GitHub App plus GHES/ghe.com;
   - GitLab (including self-managed);
   - Jira and Confluence (Forge or OAuth, not Connect);
   - Azure DevOps (Entra ID only).
   Together these cover the large majority of enterprise code and ticket estates.
3. **Win regulated buyers:**
   - VPC and air-gapped packaging, Postgres, and the outbound relay;
   - SSO and SCIM;
   - SIEM export and MCP-registry listing;
   - SOC 2 Type II.
4. **Differentiate:**
   - Bitbucket, Teams, and incident postmortems;
   - onboarding hindcast;
   - the "who knows what" directory;
   - the organisational-memory benchmark.

## Sources

Market and platform (each figure's source was recorded in the research pass):

- Stack Overflow 2025 survey summaries (stackoverflow.blog, Pragmatic Engineer); GitHub Octoverse 2025.
- JetBrains State of Developer Ecosystem 2025 and State of CI/CD 2025.
- GitLab Q4 FY26 results (ir.gitlab.com); GitLab FedRAMP Moderate release.
- GitHub changelog: data residency US/Japan GA; remote MCP server GA; Copilot residency and FedRAMP; knowledge-base sunset; MCP registry allowlists.
- GitHub docs: API rate limits, rulesets, merge queue.
- Atlassian: Data Center end of life (Bitbucket DC exemption), Bitbucket app-password deprecation, Connect end of support, Rovo MCP GA, Teamwork Graph connectors.
- Microsoft DevOps blog and Learn: no new ADO OAuth apps, global PAT deprecation, service principals, ADO rate limits, ADO remote MCP GA, ADO Server versionless GA.
- AWS: CodeCommit return to GA. Google: Cloud Source Repositories migration, Gemini code customization via Developer Connect.
- Perforce P4 launch and 2024 game-tech report; Gerrit and AGL.
- Slack 2025 rate-limit change for non-Marketplace apps; Opsgenie end of life; PagerDuty, Datadog and Grafana Labs filings and press; CNCF Argo CD survey; DORA 2025; Spotify Backstage five-year post; Port funding.
- Vendor docs for Sourcegraph, Glean, Augment, Tabnine, Cursor, Devin, Amazon Q/Kiro and JetBrains AI.

Research literature:

- **Repository mining:** Śliwerski et al. 2005 (SZZ); Rosa et al. ICSE 2021 (arXiv:2102.03300); LLM4SZZ ISSTA 2025 (arXiv:2504.01404); Levin & Yehudai 2017 (arXiv:1711.05340); Herzig & Zeller MSR 2013; Zimmermann et al. TSE 2005; Kamei et al. TSE 2013; Bacchelli & Bird ICSE 2013; Potdar & Shihab ICSME 2014; Avelino et al. ICPC 2016 (arXiv:1604.06766).
- **Repository context for agents:** Jimenez et al. ICLR 2024 (SWE-bench); Yang et al. NeurIPS 2024 (SWE-agent); Xia et al. 2024 (Agentless, arXiv:2407.01489); Liu et al. TACL 2024 (Lost in the Middle).
- **Agent memory:** Park et al. UIST 2023; Zhong et al. AAAI 2024 (MemoryBank); Chhikara et al. 2025 (Mem0, arXiv:2504.19413); Rasmussen et al. 2025 (Zep, arXiv:2501.13956); Gutiérrez et al. 2024/2025 (HippoRAG 1/2); Wang et al. 2024 (Agent Workflow Memory, arXiv:2409.07429); Ouyang et al. 2025 (ReasoningBank, arXiv:2509.25140).
- **2026 preprints:** arXiv:2602.21611, 2603.26664, 2602.08316, 2608.20664, 2606.15017, 2602.11988, 2601.20404, 2606.20882, 2605.05287.
- **Organizational memory:** Wegner 1987 (transactive memory); Walsh & Ungson 1991 (organizational memory).
- **Memory security:** Dong et al. 2025 (MINJA, arXiv:2503.03704); Meli et al. NDSS 2019 (secrets in Git).
