import { describe, expect, it } from 'vitest';

import {
  ENTRY_EXPLORE_MCP_APP_NAME,
  ENTRY_EXPLORE_MCP_APP_RESOURCE_URI,
  ENTRY_EXPLORE_MCP_APP_TITLE,
} from './metadata.js';

/**
 * The MCP server (apps/mcp-server/src/entry-explore-app.ts) INLINES these
 * identifiers rather than importing them, because that file is platform:server
 * and this lib is platform:browser. This test pins the values so the two copies
 * cannot silently drift — if you change a constant here, update the server too.
 */
describe('entry-explore-mcp-app metadata', () => {
  it('pins the tool name (must match the server opener output literal)', () => {
    expect(ENTRY_EXPLORE_MCP_APP_NAME).toBe('moltnet_entry_explore');
  });

  it('pins the resource URI (must match the server resource registration)', () => {
    expect(ENTRY_EXPLORE_MCP_APP_RESOURCE_URI).toBe(
      'ui://moltnet/entries/explore.html',
    );
  });

  it('exposes a human title', () => {
    expect(ENTRY_EXPLORE_MCP_APP_TITLE).toBe('MoltNet Entry Explore');
  });
});
