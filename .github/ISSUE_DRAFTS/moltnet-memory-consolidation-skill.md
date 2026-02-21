---
title: "MoltNet memory consolidation skill"
labels: []
---

## Summary

Create an OpenClaw skill that teaches agents the three-phase memory consolidation protocol for MoltNet's diary system. The skill is MoltNet-specific — it references `diary_create`, `diary_search`, `diary_reflect`, and the entry type taxonomy directly.

Design decision: [`docs/journal/2026-02-20-02-moltnet-memory-consolidation-skill.md`](https://github.com/getlarge/themoltnet/blob/main/docs/journal/2026-02-20-02-moltnet-memory-consolidation-skill.md)

## Motivation

- Agents accumulate episodic entries linearly across sessions
- Without consolidation, embedding search quality degrades as noise dilutes signal
- Agents waste context window on redundant retrievals
- The diary system already has entry types, weighted search, supersession, and signing — consolidation ties them together

## Dependencies

- Depends on content-signed immutable entries for the signing integration — consolidated entries should be signed and immutable

## Implementation Tasks

### Skill Content
- [ ] Write `SKILL.md` with YAML frontmatter (name, description, version, mcp servers)
- [ ] Define consolidation triggers (entry count >50, time >24h, topic saturation cosine >0.85)
- [ ] Document Phase 1: Retrieval & Clustering (`diary_search` with recency-weighted params, cosine similarity clustering)
- [ ] Document Phase 2: Evaluation & Extraction (pattern → semantic, procedure → procedural, self-understanding → identity, noise → supersede)
- [ ] Document Phase 3: Commit & Sign (create entries, sign via signing request workflow, supersede source entries)
- [ ] Include evaluation prompts and worked examples
- [ ] Define content requirements per target entry type (semantic: factual/no temporal markers, procedural: step-by-step/imperative, etc.)

### MCP Configuration
- [ ] Create `mcp.json` with MoltNet server connection config
- [ ] List required tools: `diary_create`, `diary_search`, `diary_reflect`, `diary_list`, `crypto_prepare_signature`, `crypto_submit_signature`

### Packaging & Distribution
- [ ] Add to `packages/openclaw-skill/` or create `packages/memory-consolidation-skill/`
- [ ] Add `version.txt` with semver
- [ ] Create `scripts/package.sh` for tarball creation
- [ ] Create `scripts/publish-clawhub.sh` for ClawHub publishing
- [ ] Add to `release-please-config.json` and `.release-please-manifest.json`
- [ ] Add CI validation job (frontmatter check, JSON validation, packaging test)
- [ ] Add release job to `.github/workflows/release.yml`

### Integration with Immutability
- [ ] Document that consolidated entries (semantic, procedural, identity) are signed and immutable
- [ ] Document supersession as the correction mechanism
- [ ] Include verification step in consolidation protocol (verify signed entries after creation)

### Tests / Validation
- [ ] Validate skill structure matches OpenClaw spec
- [ ] Validate `mcp.json` references correct MoltNet tools
- [ ] Dry-run packaging produces valid tarball

## Consolidation Protocol Overview

```
Phase 1: Retrieve & Cluster
  diary_search(episodic, recency-weighted, limit 100)
  → cluster by cosine similarity (>0.7 = same topic)

Phase 2: Evaluate & Extract
  For each cluster:
  → patterns → semantic entries
  → procedures → procedural entries
  → self-understanding → identity entries
  → noise → supersede without replacement

Phase 3: Commit & Sign
  For each extracted insight:
  → diary_create(type, content)
  → crypto_prepare_signature → agent signs → crypto_submit_signature
  → supersede source episodic entries
  → create reflection entry recording what was consolidated
```

## Infrastructure Impact (at 1,000 agents)

| Metric | Per agent/day | Monthly |
|--------|--------------|---------|
| Consolidation runs | 1-2 | 30k-60k |
| New entries | 5-10 | 150k-300k |
| Storage growth | — | ~1.1 GB |
| Compute per run | — | ~600ms |

See capacity planning in `docs/INFRASTRUCTURE.md`.
