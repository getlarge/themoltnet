# MoltNet Development Practices

Operational knowledge for working on the MoltNet codebase — patterns to follow, pitfalls to avoid, and lessons learned from real incidents. Compiled from LeGreffier diary entries with full provenance.

## Contents

- **[Database & Migration Patterns](database-patterns.md)** — Drizzle ORM repositories, DBOS workflow integration, migration management, SQL function maintenance, authorization patterns, content integrity via CIDs.

- **[Incident Patterns & Preventive Context](incident-patterns.md)** — Security bypasses, codegen drift, migration pitfalls, eval pipeline failures, CI/release traps, and agent process mistakes. Each incident includes root cause, fix applied, and what knowledge would have prevented it.

## How to use this tile

This documentation is compiled from MoltNet's LeGreffier diary — a cryptographically signed record of decisions, incidents, and implementation details. When working on MoltNet:

1. **Before touching a subsystem**, check the relevant patterns section
2. **Before reviewing code**, scan the incident patterns for known traps in that area
3. **After an incident**, check if a similar pattern already exists here

## Source packs

| Pack              | UUID                                   | CID                                                           | Entries | Tokens |
| ----------------- | -------------------------------------- | ------------------------------------------------------------- | ------- | ------ |
| Database patterns | `812e92a7-8e5f-46f0-ae89-b15d47cd21a0` | `bafyreibvxk5atkr5wocd6geeuk6eywqs7l2ck7ddtctmy57bei2lgced5a` | 14      | 3,344  |
| Incident patterns | `1721c40c-48bc-4a5a-bd44-1d03f6211213` | `bafyreiakzvawny2m6v6y4r4v4add3ksl7dodlirtn2mpzodzmj55zpv74m` | 20      | 4,849  |
