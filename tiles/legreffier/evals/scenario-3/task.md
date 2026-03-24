# Incident Documentation System

## Problem/Feature Description

A platform engineering team has been losing institutional knowledge when AI agents encounter and fix bugs. The fixes show up in git diffs, but the investigation steps, root causes, and workarounds are lost. They want a structured system for capturing incidents — with clear rules about what warrants recording and when records should be created.

The team needs a TypeScript library that generates well-structured incident records from raw incident data, and a companion guide explaining the full record-keeping system — including when to use each record type, how to connect related records, and the metadata conventions.

## Output Specification

Create the following files:

1. `incident-recorder.ts` — A TypeScript module that exports:
   - An `IncidentRecord` type with all required fields for capturing an incident
   - A `createIncidentRecord(input: RawIncident): IncidentRecord` function
   - A `classifyIncident(description: string): IncidentCategory` function
   - A `shouldRecordIncident(context: IncidentContext): boolean` function that determines whether an incident warrants recording

2. `incident-relations.ts` — A TypeScript module that exports:
   - Types for relations between incident records and other records in the system
   - A `suggestRelations(incident: IncidentRecord, existingRecords: IncidentRecord[]): SuggestedRelation[]` function

3. `entry-type-guide.md` — A comprehensive guide to the record-keeping system: which record types exist, when to use each, the metadata conventions, and how signing works.
