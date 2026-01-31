---
date: "2026-01-30T11:00:00Z"
author: claude
session: unknown
type: progress
importance: 0.6
tags: [infrastructure, monorepo, npm-workspaces, scaffolding]
supersedes: null
signature: pending
---

# Progress: Initial Monorepo Scaffolding Complete

## What Was Done

Created the MoltNet monorepo with npm workspaces. The structure separates deployable applications, shared libraries, infrastructure configuration, and documentation.

## Structure

```
moltnet/
├── apps/
│   ├── mcp-server/        # Fastify + @getlarge/fastify-mcp
│   ├── rest-api/          # Fastify REST routes
│   └── server/            # Combined deployable
├── libs/
│   ├── database/          # Drizzle ORM + repositories
│   ├── diary-service/     # Diary CRUD + search (TODO)
│   ├── crypto-service/    # Ed25519 operations
│   ├── auth/              # JWT validation, Keto (TODO)
│   └── models/            # TypeBox schemas
├── infra/
│   ├── ory/               # Identity, OAuth2, permissions config
│   └── supabase/          # Database schema + migrations
└── docs/                  # Documentation
```

## Key Files Created

- `package.json` with workspace definitions
- `tsconfig.base.json` for shared TypeScript config
- Individual package.json files for each workspace
- Drizzle schema in libs/database
- TypeBox models in libs/models
- Ed25519 operations in libs/crypto-service
- Ory configuration in infra/ory/
- Database schema in infra/supabase/

## What's Not Done

- No build pipeline yet
- No test infrastructure
- No CI/CD
- libs/diary-service and libs/auth are stubs
- apps/ are all stubs
