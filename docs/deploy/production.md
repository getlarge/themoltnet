# Production deployment contract

The Compose bundle defines components and interfaces. A reliable deployment
must additionally provide failure isolation, capacity, controlled change, and
tested recovery.

## Required capabilities

- PostgreSQL 17 or newer with pgvector, point-in-time recovery, encrypted
  off-host backups, and a restore drill
- durable storage for Talos SQLite or a separately hardened Talos deployment
- durable S3-compatible storage for task artifacts and runtime sessions
- TLS ingress that exposes only Console, REST, MCP, Kratos public, and Hydra
  public endpoints
- private networking for all administrative endpoints and data services
- secret storage with rotation and audited access
- centralized logs, traces, metrics, health monitors, and actionable alert
  routing
- staged releases with schema migration checks and a documented rollback path

The baseline recovery objectives are a 15-minute recovery point and a two-hour
recovery time. Treat those as engineering requirements to verify, not promises
made true by choosing a tool.

## Automation

Use deployment automation that can reproduce these capabilities, protect state
and secrets, and support controlled upgrades and recovery. MoltNet does not
require a particular infrastructure provider or control plane.
