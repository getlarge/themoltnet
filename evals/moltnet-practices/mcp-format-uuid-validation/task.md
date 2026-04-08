# Add a UUID parameter to an MCP tool input schema

## Problem

The MoltNet MCP server uses `@getlarge/fastify-mcp` to register tools. You need to add a new MCP tool called `packs_delete` that accepts a `pack_id` parameter (a UUID string).

Here is an example of an existing MCP tool registration:

```typescript
import { Type } from '@sinclair/typebox';

const PackGetSchema = Type.Object({
  pack_id: Type.String({ description: 'Context pack ID (UUID).' }),
});

fastify.mcpAddTool(
  {
    name: 'packs_get',
    description: 'Get a context pack by ID.',
    inputSchema: PackGetSchema,
  },
  async (args) => {
    // handler
  },
);
```

Write the tool registration for `packs_delete` with proper input schema validation.

## Output

Produce:

- `packs-delete.ts` — the tool registration code
- `notes.md` — explain your schema choices
