---
type: discovery
date: 2026-02-03
author: Claude (Sonnet 4.5)
tags: [fastify, plugins, encapsulation, webhooks, debugging]
workstream: WS6
---

# Discovery: Fastify Plugin Encapsulation Causes Webhook Route 404s

## Context

While working on REST API e2e tests, webhook routes at `/hooks/kratos/*` and `/hooks/hydra/*` were returning 404 errors despite:

- `printRoutes()` showing them as registered
- `hasRoute()` returning `true`
- Unit tests with `app.inject()` passing
- No error logs in Fastify

This was a subtle but critical bug that took significant investigation to understand.

## The Problem

Routes defined in `apps/rest-api/src/routes/hooks.ts` were visible in route listings but unreachable via real HTTP requests. The 404 errors were misleading - they weren't coming from missing routes, but from Fastify's encapsulation system.

## Root Cause: Fastify Plugin Encapsulation

According to the [Fastify Plugins Guide](https://fastify.dev/docs/latest/Guides/Plugins-Guide/):

> "Register creates a new Fastify context, which means that if you perform any changes on the Fastify instance, those changes will not be reflected in the context's ancestors."

**The critical insight**: When you pass custom options to a plugin, it creates an **encapsulated scope**. Routes registered inside that scope are not accessible at the parent level where the HTTP server is listening.

### What Was Happening

```typescript
// apps/rest-api/src/routes/hooks.ts (BROKEN)
export async function hookRoutes(
  fastify: FastifyInstance,
  opts: HookRouteOptions  // ❌ Custom options trigger encapsulation
) {
  fastify.post('/hooks/kratos/after-registration', ...);
}

// apps/rest-api/src/app.ts
await app.register(hookRoutes, {
  webhookApiKey: options.webhookApiKey,  // ❌ Creates isolated scope
  oauth2Client: options.oryClients.oauth2,
});
```

The routes existed in an **encapsulated child context**, not at the root level where HTTP requests arrive.

### Why Unit Tests Worked

`app.inject()` bypasses the HTTP layer and directly invokes Fastify's routing, which can access encapsulated routes. This is why unit tests passed but real HTTP requests failed.

### Why `fastify-plugin` Didn't Help Initially

I tried wrapping the plugin with `fp()` from `fastify-plugin`, but this created a different issue. According to search results and the [fastify-plugin documentation](https://www.npmjs.com/package/fastify-plugin):

> "By default, fastify-plugin breaks the encapsulation but this option will not work for route prefixes."

`fastify-plugin` is designed for **decorators and hooks**, not for routes that need custom options. When you wrap a route-defining plugin with `fp()` while also passing custom options, the routes can behave unexpectedly.

## The Solution

**Use decorators instead of plugin options** for shared state:

```typescript
// apps/rest-api/src/routes/hooks.ts (FIXED)
declare module 'fastify' {
  interface FastifyInstance {
    webhookApiKey: string;
    oauth2Client: OryClients['oauth2'];
  }
}

export async function hookRoutes(fastify: FastifyInstance) {
  // Access via decorators, not opts parameter
  const webhookAuth = validateWebhookApiKey(fastify.webhookApiKey);
  // ...
}

// apps/rest-api/src/app.ts
app.decorate('webhookApiKey', options.webhookApiKey);
app.decorate('oauth2Client', options.oryClients.oauth2);

await app.register(hookRoutes); // No custom options = no encapsulation
```

Now the routes are registered at the root level and accessible via HTTP.

## Key Learnings

### 1. Plugin Encapsulation Rules

- **Custom options = encapsulated scope**: Passing options to `register()` creates isolation
- **Decorators are for shared state**: Use `fastify.decorate()` for dependencies
- **Routes need root-level registration**: Don't wrap route plugins in encapsulated contexts

### 2. When to Use `fastify-plugin`

✅ **Use `fp()` for**:

- Decorators that should be globally available
- Hooks that should apply to all routes
- Utility plugins that don't define routes

❌ **Don't use `fp()` for**:

- Route-defining plugins with custom options
- Plugins that need encapsulation for security

### 3. Debugging Fastify Routes

- `printRoutes()` shows routes in all contexts (misleading when encapsulated)
- `hasRoute()` checks the current context (also misleading)
- `app.inject()` can reach encapsulated routes (unit tests pass, HTTP fails)
- Check for **encapsulation issues** when routes "exist" but return 404

### 4. Comparison with Other Route Plugins

```typescript
// Other routes that work (no custom options)
export async function diaryRoutes(fastify: FastifyInstance) {}
export async function agentRoutes(fastify: FastifyInstance) {}
export async function healthRoutes(fastify: FastifyInstance) {}

// Hooks needed custom options (the problem)
export async function hookRoutes(
  fastify: FastifyInstance,
  opts: HookRouteOptions,
) {}
```

The difference: `hookRoutes` took options, creating an encapsulated scope.

## Related Issues

- **Keto Configuration (Issue #61)**: The 404 investigation revealed that Keto's "agents" namespace wasn't loading, causing permission checks to fail. This was a separate issue that became visible once webhook routes started working.

- **RFC 9457 Error Handling (Issue #60)**: Inconsistent error responses across the API made debugging harder. Created issue to standardize on Problem Details format.

## Resources

- [Fastify Plugins Guide](https://fastify.dev/docs/latest/Guides/Plugins-Guide/)
- [Fastify Encapsulation](https://fastify.dev/docs/latest/Reference/Encapsulation/)
- [fastify-plugin documentation](https://www.npmjs.com/package/fastify-plugin)
- [GitHub Issue: 404 error with prefixed plugin](https://github.com/fastify/fastify/issues/2738)

## Files Changed

- `apps/rest-api/src/routes/hooks.ts` - Removed options parameter, added decorator types
- `apps/rest-api/src/app.ts` - Added decorators, removed options from register call
- `apps/rest-api/e2e/setup.ts` - Added configurable logger, Keto workaround

## Takeaway

When Fastify routes return 404 despite being "registered," check for **plugin encapsulation issues**. If your plugin takes custom options and defines routes, switch to decorators for shared state. The `fastify-plugin` wrapper is not a universal solution - it's specifically for breaking encapsulation of decorators/hooks, not routes with options.
