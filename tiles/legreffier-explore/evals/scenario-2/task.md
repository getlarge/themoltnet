# Commit Quality Analyzer

## Problem/Feature Description

An engineering team uses a diary system to track every commit with structured metadata. Over months of use, they suspect tagging quality has degraded — duplicate prefixes in tags, missing branch tags, overly broad commits. They need a tool that analyzes procedural (commit-related) diary entries and surfaces quality issues.

The team wants to understand which branches have the most activity, what tags are most common on commit entries, and what anti-patterns exist in their tagging practices.

## Output Specification

Create the following files:

1. `commit-analyzer.ts` — A TypeScript module that exports:
   - A `analyzeCommitPatterns(entries: DiaryEntry[]): CommitReport` function
   - A `detectAntiPatterns(entries: DiaryEntry[]): AntiPattern[]` function
   - Types for the report and anti-pattern structures

2. `commit-report.md` — A sample report from analyzing the provided sample data, showing tag frequencies, branch distribution, and any anti-patterns found.

## Input Files

The following files are provided as inputs. Extract them before beginning.

=============== FILE: inputs/procedural-entries.json ===============
[
{"id":"p1","entryType":"procedural","tags":["accountable-commit","risk:high","branch:feat/auth","scope:auth"],"importance":8,"content":"files-changed: 5\nrefs: libs/auth/src/middleware.ts"},
{"id":"p2","entryType":"procedural","tags":["accountable-commit","risk:medium","branch:feat/auth","scope:auth"],"importance":5,"content":"files-changed: 2\nrefs: libs/auth/src/types.ts"},
{"id":"p3","entryType":"procedural","tags":["accountable-commit","risk:low","branch:feat/api","scope:api"],"importance":2,"content":"files-changed: 1\nrefs: libs/api/README.md"},
{"id":"p4","entryType":"procedural","tags":["accountable-commit","risk:high","branch:feat/db","scope:scope:db"],"importance":8,"content":"files-changed: 12\nrefs: libs/database/src/schema.ts, libs/database/drizzle/"},
{"id":"p5","entryType":"procedural","tags":["accountable-commit","branch:feat/db"],"importance":5,"content":"files-changed: 3\nrefs: libs/database/src/repo.ts"},
{"id":"p6","entryType":"procedural","tags":["accountable-commit","risk:medium","branch:main","scope:ci"],"importance":5,"content":"files-changed: 2\nrefs: .github/workflows/ci.yml"},
{"id":"p7","entryType":"procedural","tags":["commit"],"importance":3,"content":"files-changed: 1"},
{"id":"p8","entryType":"semantic","tags":["decision","branch:feat/db","scope:db"],"importance":7,"content":"Chose Drizzle ORM"}
]
=============== END FILE ===============
