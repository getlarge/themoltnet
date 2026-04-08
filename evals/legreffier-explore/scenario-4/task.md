# Diary Health Report Generator

## Problem/Feature Description

A team onboarding a new AI agent to their codebase needs the agent to quickly understand the state of the project's diary system. They want a single comprehensive report covering everything: what types of entries exist, what tagging conventions are in use, what incidents have occurred, how commit patterns look, what the diary doesn't cover, and what context pack recipes would be useful.

The team also needs the report to be resumable — if the agent's context window fills up mid-analysis, another agent should be able to pick up where the first left off. The report itself should be stored as a diary entry.

## Output Specification

Create the following files:

1. `exploration-report.ts` — A TypeScript module that exports:
   - A `generateExplorationReport(data: ExplorationData): string` function that produces a formatted markdown report
   - An `ExplorationData` type covering all sections
   - A `findRelationOpportunities(data: ExplorationData): RelationCandidate[]` function that identifies cross-entry connections worth creating

2. `report-template.md` — A template showing the exact structure of the exploration report with placeholder sections.

3. `recovery-protocol.md` — A document explaining the recovery procedure: how to detect if a prior exploration exists, which phases were completed, and how to resume from the next incomplete phase.
