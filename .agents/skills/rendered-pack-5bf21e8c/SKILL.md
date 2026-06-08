---
name: rendered-pack-5bf21e8c
description: Use when editing MoltNet docs, especially onboarding, docs IA, examples, tone, cross-links, and avoiding duplicated canonical guidance.
moltnet:
  rendered_pack_id: 5bf21e8c-f3c7-4ba9-8d46-18b2e990f71e
  rendered_pack_cid: bafyreibyufpxxxvrt5u4qtqehd7yzmx23o2yhfawx2c2janfmnxky6xa2u
  source_pack_id: a719f9d0-1be6-4b61-aece-dc14e95afe9c
  bundled_at: 2026-06-08T16:40:50Z
---

# Context Pack a719f9d0-1be6-4b61-aece-dc14e95afe9c

- Created: 2026-06-08T16:36:00.803Z
- Entries: 9

### Docs onboarding belongs in one canonical flow

- Entry ID: `210007f3-bee4-44da-9fb4-12484333e1df`
- CID: `bafkreide5x73w2fzuyukboxpcpqfwdi4fdw5xoac264mfeyxythv6hpzuq`
- Compression: `full`
- Tokens: 134/134

Docs should read as product and operator documentation, not as process notes between an AI agent and a maintainer. Avoid phrases like "this section should stay short" or route-map language that explains the documentation artifact instead of guiding the reader.

For onboarding docs, prefer one canonical flow over a parallel page. Extend the existing page at the relevant decision point and link to the command/reference guides for details. Do not duplicate the identity-flow, team, task, daemon, or access-control explanations when those pages already exist.

<metadata>
operator: edouard
tool: codex
timestamp: 2026-06-08T15:34:40Z
branch: codex/company-pilot-onboarding
scope: docs,onboarding,tone
refs: docs/start/getting-started.md, docs/start/install-and-initialize.md, docs/reference/agent-configuration.md
</metadata>

### Docs editing pack candidate

- Entry ID: `b875bde8-6529-4135-8d17-e625920d9e35`
- CID: `bafkreibzoagbskxemlwjweodb742p2xyvialituzmaqxl724yndy72p3hu`
- Compression: `full`
- Tokens: 131/131

This onboarding-docs correction should seed a future docs-editing context pack. The useful pattern is not just wording cleanup; it is a docs architecture rule: avoid adding parallel pages when an existing canonical guide already owns the reader journey.

Candidate pack ingredients: docs tone expectations, onboarding flow placement, cross-linking without duplication, and examples of phrasing that sounds like internal process notes rather than user-facing documentation. The pack should activate when editing docs/start, docs/use, docs/reference, or when a reviewer asks for docs tone/duplication cleanup.

<metadata>
operator: edouard
tool: codex
timestamp: 2026-06-08T15:35:40Z
branch: codex/company-pilot-onboarding
scope: docs,context-packs,onboarding
refs: docs/start/install-and-initialize.md, docs/start/getting-started.md, docs/use/context-packs.md
</metadata>

### Accountable commit: Docs restructure: align the 'Use' section with actual usage order and consolidate scattered pages.

- Entry ID: `65a6130b-2055-480b-8a2d-d5f723cd5d76`
- CID: `bafkreidc5jm24naixep2stwnrunungudo6xy535fr2qotpcwpaown54svi`
- Compression: `full`
- Tokens: 376/376

<content>
Docs restructure: align the 'Use' section with actual usage order and consolidate scattered pages.

Changes:

1. Moved 'Human connectors' (Claude.ai/Desktop, ChatGPT custom app) from docs/start/install-and-initialize.md to a new 'Human MCP connectors' section in docs/use/sdk-and-integrations.md. Install page now has a 5-line forward link. Rationale: agent setup and chat-client connector setup are different audiences; integrations belongs under Use.
2. Reordered the Use sidebar to match actual workflow (SDK/Teams/Entries/LeGreffier flows/Context Packs/Tasks/Agent Runtime/Agent Daemon/Agent Executors/Context Pack Evals). Added an Agent Runtime Concepts cross-link from Use into the existing Understand page rather than moving the file (preserves backlinks).
3. Merged rendered-packs.md into context-packs.md as a new 'Load a rendered pack into an agent session' section. Updated inbound cross-links in getting-started.md and knowledge-factory.md. Removed the sidebar entry.
4. Added a 'Rendering from an agent that isn't on the MoltNet runtime' subsection with a copy-pasteable prompt template. The prompt embeds the legreffier-explore Phase 6 pack-to-docs 8-step transformation (strip scaffolding/keep provenance, group by topic, dedupe/merge, callouts, per-section sources, keyword anchors, provenance header, structure for scanning) so the resulting markdown is actually useful docs and not just linearised entry dump. References libs/agent-runtime/src/prompts/render-pack.ts honestly — noting the in-runtime prompt delegates to the server method.
5. Moved docs/use/local-runtime-testing.md verbatim into apps/agent-daemon/README.md as a new 'Local development & smoke testing' section; deleted the docs page and its sidebar entry; updated docs/use/agent-daemon.md to link to the README and updated AGENTS.md/CLAUDE.md to point at the new location.

Out of scope for this PR (follow-up): rewriting docs/use/context-pack-evals.md (still references the old Harbor design and predates the current Agent Runtime model).
</content>
<metadata>
signer: 1671-B080-99BF-4270
operator: edouard
tool: claude
risk-level: low
files-changed: 11
refs: AGENTS.md, apps/agent-daemon/README.md, docs/.vitepress/config.ts, docs/start/getting-started.md, docs/start/install-and-initialize.md
timestamp: 2026-05-12T14:03:57Z
branch: docs/use-section-reorder
scope: docs, agent-daemon
</metadata>

### Accountable commit: Restructure docs/use/tasks.

- Entry ID: `a075b46c-111c-46b1-bab2-0c897cf5581e`
- CID: `bafkreibswrlnlxmrz53rj6texajedhe56hheabwzcupfxgweauipwdss5a`
- Compression: `full`
- Tokens: 223/223

<content>
Restructure docs/use/tasks.md to consistently apply the 'Create your first diary' three-tab pattern across every operation (Agent CLI / Human SDK / MCP Tool), instead of using one monolithic code-group as a workflow multiplexer. Previous version had each tab containing 5 sequential bash steps (impose → tail → get → attempts → judge) — that's a workflow, not 'same operation, three surfaces'. New layout: an Operations section with one atomic three-tab block per call (Impose, Inspect, List, Read produced output, Watch in real time), and the brief→fulfil→assess workflow becomes a numbered prose section linking back to those operations. The CLI tab for Impose now honestly admits the 'moltnet task create' gap and shows the curl fallback, rather than smuggling curl into a CLI tab while the SDK/MCP tabs use native calls. MCP tabs are minimal {arguments, tool} JSON matching the diary doc's style. Ran nx format:write.
</content>
<metadata>
signer: 1671-B080-99BF-4270
operator: edouard
tool: claude
risk-level: low
files-changed: 1
refs: docs/use/tasks.md
timestamp: 2026-05-12T11:33:26Z
branch: feat/cli-task-attempts-1130
scope: docs
</metadata>

### Accountable commit: Two small fixes to docs/use/context-packs.

- Entry ID: `55dec741-5681-4b77-b5f4-ab7bdeba67eb`
- CID: `bafkreie3sxmlqto6bfdxwt5jeeemk5dyjmp44777tt7j7t3fkokstkfkdy`
- Compression: `full`
- Tokens: 159/159

<content>
Two small fixes to docs/use/context-packs.md on PR #1137. (1) Move <InteractivePacksExample /> from 'Load a rendered pack into an agent session' to 'Compose a pack from selected entries' — the component's title is literally 'Create a context pack' and it demonstrates packs_create, which is the curation step before rendering. Placing it next to the loading section conflated two distinct phases of the knowledge-factory pipeline (discover → curate → render → load). (2) Delete the 'Why singular rendered-pack?' subsection — it's CLI-vs-REST naming trivia that adds no value for someone trying to learn how to use rendered packs.
</content>
<metadata>
signer: 1671-B080-99BF-4270
operator: edouard
tool: claude
risk-level: low
files-changed: 1
refs: docs/use/context-packs.md
timestamp: 2026-05-12T15:02:36Z
branch: docs/use-section-reorder
scope: docs
</metadata>

### Docs: standardize context-pack examples

- Entry ID: `dfe5cae0-4e85-4a29-ba1b-fefd427bb2b4`
- CID: `bafkreifz4wtrdud723rglsj5zkempqtwdfbs4qok7chfmhuhinwwurnhbq`
- Compression: `full`
- Tokens: 59/59

Standardized the context-packs docs to the new example-command pattern. Updated tag-convention discovery to show Agent CLI, Human SDK, and MCP tabs, and updated rendered-pack activation description to show CLI, SDK, and MCP update paths. Kept the work isolated in the docs/context-pack-tabs-origin-main worktree off origin/main.

### Document MoltNet accessibility checklist

- Entry ID: `80cd8936-1cb9-41e0-b80b-784353c67340`
- CID: `bafkreibdd3jz3kew25f62nbaozlae3oa5kxjtqp5gtjzgjprdyy2htrudi`
- Compression: `full`
- Tokens: 82/82

Added a docs-level accessibility guide for browser apps, docs pages, forms, graph/data surfaces, validation, and current lint enforcement. Linked it from the VitePress Understand sidebar and cross-linked it from the design system guide so builders can distinguish component-level rules from product/page-level checks. Validation passed with nx docs lint, typecheck, and build.\n\n<metadata>\noperator: edouard\ntool: codex\ntimestamp: 2026-06-07T13:29:00Z\nbranch: docs-accessibility-guidance\nscope: docs\nrefs: docs/understand/accessibility.md, docs/understand/design-system.md, docs/.vitepress/config.ts\nrisk-level: low\nfiles-changed: 3\n</metadata>

### Revise docs PR to remove obsolete docs

- Entry ID: `79891286-4000-4b79-95c7-2a37c9978a76`
- CID: `bafkreid7k2m3b2w4qvr5mmxdpe6ea4fxmexdg7ldihheys2tkmiqbxngie`
- Compression: `full`
- Tokens: 139/139

Revised PR #1088 after review: split the oversized start/getting-started.md into install, diary harvesting, context pack, eval, rendered-pack, commit-authorship, and quick-reference pages. Removed deprecated docs instead of keeping compatibility stubs: builder journal, doc maintenance, builders manifesto, agent coordination, sandbox, task lifecycle, OpenClaw integration, and old root duplicates. Removed obsolete Claude project-board lifecycle commands (claim/handoff/sync), feature-dev plugins, and related gh project permissions. Updated onboarding skill links and source comments to the new canonical docs paths. Validation: pnpm --filter @moltnet/docs build passed in the isolated PR worktree.

<metadata>
operator: edouard
tool: codex
timestamp: 2026-05-10T06:45:00Z
branch: codex-docs-purpose-ia
scope: docs,docs-ia,claude-settings
refs: docs/start/getting-started.md,docs/start/install-and-initialize.md,docs/use/context-packs.md,.claude/settings.json,.claude/commands/claim.md
signer: 1671-B080-99BF-4270
risk-level: medium
files-changed: 60
</metadata>

### Docs onboarding tone cleanup

- Entry ID: `30939b81-bb47-4ed2-9b53-a4f9b4cd4f50`
- CID: `bafkreibu6witk37mwcousirnssy2ldoln6s5azt37qu36otclem2r6ckcm`
- Compression: `full`
- Tokens: 96/96

Updated the onboarding docs so they read as user-facing product documentation instead of internal process notes. Replaced meta wording in Getting Started, removed future/internal phrasing from Install and Initialize, and linked the team creation step directly to console.themolt.net.

Validation: pnpm --filter @moltnet/docs build.

Related entries: 210007f3-bee4-44da-9fb4-12484333e1df (docs tone rule), b875bde8-6529-4135-8d17-e625920d9e35 (docs pack candidate).

<metadata>
operator: edouard
tool: codex
timestamp: 2026-06-08T15:36:20Z
branch: codex/company-pilot-onboarding
scope: docs,onboarding,tone
refs: docs/start/getting-started.md, docs/start/install-and-initialize.md
risk-level: low
files-changed: 2
</metadata>
