# Diary Inventory Analyzer

## Problem/Feature Description

A team uses a structured diary system to track decisions, incidents, and commits across their projects. Over time, diaries accumulate hundreds of entries with various tags and metadata. Before they can build useful context packs or search indexes, they need to understand what's actually in each diary — entry types, tagging conventions, importance distributions, and time ranges.

The team needs a TypeScript tool that takes a flat list of diary entries and produces a structured inventory report. The tool should handle pagination (entries arrive in batches) and discover organizational patterns from the data itself rather than assuming any particular structure.

## Output Specification

Create the following files:

1. `inventory-analyzer.ts` — A TypeScript module that exports:
   - An `analyzeInventory(entries: DiaryEntry[]): InventoryReport` function
   - A `DiaryEntry` type and `InventoryReport` type
   - A `paginateEntries(fetchFn: FetchFn, batchSize: number): Promise<DiaryEntry[]>` function that handles pagination

2. `inventory-report.md` — A sample report produced by running the analyzer against the provided sample data. Format as markdown tables and trees.

## Input Files

The following files are provided as inputs. Extract them before beginning.

=============== FILE: inputs/sample-entries.json ===============
[
{"id":"e1","entryType":"procedural","tags":["accountable-commit","risk:high","branch:feat/auth","scope:auth"],"importance":8,"createdAt":"2026-01-15T10:00:00Z","content":"JWT validation"},
{"id":"e2","entryType":"procedural","tags":["accountable-commit","risk:medium","branch:feat/auth","scope:auth"],"importance":5,"createdAt":"2026-01-16T11:00:00Z","content":"Add middleware"},
{"id":"e3","entryType":"semantic","tags":["decision","branch:feat/auth","scope:auth","scope:crypto"],"importance":7,"createdAt":"2026-01-17T09:00:00Z","content":"Use Ed25519"},
{"id":"e4","entryType":"episodic","tags":["incident","branch:fix/arm64","scope:crypto","workaround"],"importance":6,"createdAt":"2026-01-20T14:00:00Z","content":"ARM64 crash"},
{"id":"e5","entryType":"procedural","tags":["accountable-commit","risk:low","branch:feat/api","scope:api"],"importance":2,"createdAt":"2026-02-01T08:00:00Z","content":"Formatting fix"},
{"id":"e6","entryType":"reflection","tags":["reflection","branch:feat/api"],"importance":5,"createdAt":"2026-02-01T18:00:00Z","content":"Session notes"},
{"id":"e7","entryType":"semantic","tags":["decision","branch:feat/db","scope:db","scope:api"],"importance":8,"createdAt":"2026-02-10T10:00:00Z","content":"Drizzle ORM choice"},
{"id":"e8","entryType":"episodic","tags":["incident","branch:feat/db","scope:db"],"importance":7,"createdAt":"2026-02-12T16:00:00Z","content":"Migration failure"},
{"id":"e9","entryType":"procedural","tags":["accountable-commit","risk:high","branch:feat/db","scope:db","scope:scope:infra"],"importance":8,"createdAt":"2026-02-15T09:00:00Z","content":"Schema change"},
{"id":"e10","entryType":"identity","tags":["system","identity"],"importance":10,"createdAt":"2026-01-10T00:00:00Z","content":"Agent identity"},
{"id":"e11","entryType":"procedural","tags":["accountable-commit","risk:medium","branch:main","scope:ci"],"importance":5,"createdAt":"2026-02-20T12:00:00Z","content":"CI pipeline"},
{"id":"e12","entryType":"semantic","tags":["decision","branch:feat/mcp","scope:mcp","learn:trace"],"importance":7,"createdAt":"2026-03-01T10:00:00Z","content":"MCP tool design"}
]
=============== END FILE ===============
