# MCP Server Tool Schemas for a Document API

## Problem/Feature Description

A development team is building an MCP (Model Context Protocol) server using Fastify and the `fastify-mcp` plugin to expose a document management API to AI assistants. The server needs to define tool schemas for several operations. The team is using JSON Schema for tool input definitions and wants them to be comprehensive, including type constraints and field descriptions.

A code reviewer has suggested adding `format` validators (like `format: "uuid"` for ID fields and `format: "date-time"` for timestamp fields) to make the schemas more precise. However, the team's tech lead has asked for careful review of this suggestion before implementing it, given past issues with the MCP tooling stack.

Implement the MCP tool schemas for the following three tools:

1. `get_document` — retrieves a document by its ID
2. `create_document` — creates a new document with a title, body, and organization ID
3. `list_documents` — lists documents with optional filtering by organization ID and a `created_after` date

Produce the schemas as a TypeScript module that exports all three tool definitions.

## Output Specification

- `mcp-tools.ts` — TypeScript module exporting the three MCP tool definitions with their input schemas
- `design-notes.md` — brief notes on any schema design decisions you made
