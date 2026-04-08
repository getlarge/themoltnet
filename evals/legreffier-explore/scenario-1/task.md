# Incident Triage Tool for Diary Entries

## Problem/Feature Description

An engineering team has been recording incidents in a structured diary system. Some entries are tagged with "incident", but older entries may lack proper tags. The team needs a tool that finds all incident-related entries — whether tagged or not — classifies their severity, extracts structured fields, and groups them by affected subsystem. The output should help identify which incidents are worth using as training examples for future agents.

## Output Specification

Create the following files:

1. `incident-triage.ts` — A TypeScript module that exports:
   - A `triageIncidents(entries: DiaryEntry[], searchResults: DiaryEntry[]): TriageReport` function
   - A `classifySeverity(entry: DiaryEntry): Severity` function
   - Types for the structured extraction (what went wrong, root cause, fix, preventive context, subsystem, severity)

2. `triage-strategy.md` — A document explaining:
   - The multi-step approach for finding incidents (both tagged and untagged)
   - How subsystems are inferred from entry data
   - The severity classification criteria
   - How to identify which incidents are good candidates for agent training tasks

## Input Files

The following files are provided as inputs. Extract them before beginning.

=============== FILE: inputs/diary-entries.json ===============
[
{"id":"inc-1","entryType":"episodic","tags":["incident","branch:feat/auth","scope:auth"],"importance":8,"content":"What happened: JWT validation accepted expired tokens in production.\nRoot cause: Date comparison used local timezone instead of UTC.\nFix applied: Switched to Date.now() / 1000 for epoch comparison.\nWatch for: Always use UTC epoch seconds for JWT exp checks."},
{"id":"inc-2","entryType":"episodic","tags":["incident","branch:fix/deploy","scope:ci","workaround"],"importance":6,"content":"What happened: Docker build failed with SIGKILL on CI runners.\nRoot cause: Node.js heap exceeded 512MB limit during TypeScript compilation.\nFix applied: Added --max-old-space-size=4096 to NODE_OPTIONS.\nWatch for: Monitor CI memory usage when adding new workspace packages."},
{"id":"inc-3","entryType":"episodic","tags":["branch:feat/mcp","scope:mcp"],"importance":5,"content":"What happened: MCP tool registration silently dropped tools with duplicate names.\nRoot cause: Fastify plugin dedup logic treated tools with same name as identical.\nFix applied: Added namespace prefix to tool names.\nWatch for: Tool name collisions when composing multiple MCP servers."},
{"id":"inc-4","entryType":"semantic","tags":["decision","branch:feat/auth","scope:auth"],"importance":7,"content":"Decision: Use Ed25519 over RSA for agent signing keys."},
{"id":"inc-5","entryType":"procedural","tags":["accountable-commit","risk:high","branch:feat/auth","scope:auth"],"importance":8,"content":"Added JWT validation middleware."}
]
=============== END FILE ===============
