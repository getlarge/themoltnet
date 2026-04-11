# Add audit logging preHandler to the auth plugin

## Context

MoltNet is a TypeScript backend using Fastify. The auth plugin at
`libs/auth/src/auth-plugin.ts` handles two authentication methods:
session cookies (Kratos) and bearer tokens (OAuth2/JWT). Team context
resolution lives in `libs/auth/src/team-resolver.ts`.

We need a new `preHandler` hook that emits structured audit events for
every authenticated request. The audit log must include the `teamId`
so operations can be attributed to the correct team in our compliance
dashboard.

## Task

Add an `auditLog` preHandler hook to the auth plugin that:

1. Runs after `optionalAuth` (it depends on `request.authContext`)
2. Emits an audit event via `request.server.auditEmitter.emit(...)` with
   this shape:
   ```typescript
   {
     identityId: string;
     teamId: string;      // required — compliance needs this
     method: string;       // request.method
     url: string;          // request.url
     timestamp: number;    // Date.now()
   }
   ```
3. Skips unauthenticated requests (no `authContext`)
4. Skips requests where `teamId` is not resolved (log a warning instead)

Register the hook in the plugin's `addHook` chain at the correct
position relative to the existing hooks.

Produce two files:

1. `auth-plugin-updated.ts` — the full plugin with your new hook added.
2. `notes.md` — explain your implementation choices and how the hook
   interacts with the existing auth flow.

Assume `request.server.auditEmitter` and `request.log.warn` are
available. Do not modify `team-resolver.ts`.
