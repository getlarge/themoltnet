---
name: security-review
description: Review a pinned pull-request diff for security regressions that require context, following recon → hypothesis → disproof → reachability → deduplication. Used by the dedicated MoltNet security review workflow.
---

# Security review

Review security risk introduced by the **pinned diff**. The changed lines define scope; surrounding code is evidence for whether a changed path is reachable and guarded. Report what was checked and what remains unclear. This is an advisory review, not a vulnerability scan or a pass certificate.

## Division of work

- Renovate proposes dependency updates and vulnerability remediation. GitHub Dependency Review checks changed dependencies against known advisories on non-draft PRs. Do not restate version age, available upgrades, or known CVEs as new findings. Review a dependency change only when the diff changes how it is used, adds a privileged install/build script, alters provenance or pinning, or changes a security boundary in a way those tools do not assess. Cite the concrete code path.
- Automated code and secret scanning own pattern matches and known signatures. Do not repeat an existing alert. Investigate contextual failures such as authorization scope, state-transition bypasses, confused deputy behavior, trust-boundary mistakes, unsafe fallbacks, and reachable data-flow chains.
- Complexity, docs, and general multi-lens reviews own their dimensions. A security finding must describe an abuse path or failure of a security invariant; missing tests, broad diffs, style, and routine operability feedback alone are outside scope.

## Procedure

1. **Recon:** Enumerate changed files and security-relevant entry points. Identify assets, callers, trust boundaries, guards, and sinks affected by the change. Use the provided base and head; inspect only the pinned revision.
2. **Hypothesize:** For each plausible regression, cite an added line (`new` side) or a deleted line (`old` side), and state an attacker-controlled source or concrete misuse condition, the changed behavior, and the possible impact. Keep candidates even when a guard might refute them.
3. **Disprove:** Read the exact changed branch and enough surrounding code to challenge every hypothesis. Check callers, schemas, authorization, flags, error paths, and alternate branches. A size cap guarding one repair path is not evidence that all repairs are skipped. Never turn absence of evidence into a failure.
4. **Trace:** For a confirmed finding, state the boundary-to-impact chain and why existing guards do not break it. If that chain cannot be established, mark the candidate **unclear** and specify the missing evidence. If a guard or unreachable path disproves it, mark **refuted**.
5. **Deduplicate:** Group by root cause and keep the most actionable changed line. Do not publish refuted candidates. Report unclear points separately from confirmed findings.

Every candidate from the hunt stage must receive confirmed, unclear, or refuted in verification. Do not compute a composite score or mark uncertainty as failure. Do not write files, run tests, or post a GitHub comment; trusted workflow code owns publication.

## MoltNet context

When relevant to a changed path, inspect Ory JWT issuer/audience validation, Keto checks, team and diary scoping, Ed25519 verification and canonical payloads, TypeBox validation at HTTP/MCP/webhook boundaries, dotenvx secret handling, and Pino/OTel redaction. These are review prompts, not automatic findings: trace a reachable regression before reporting one.
