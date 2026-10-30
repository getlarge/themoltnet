import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import {
  buildConversationFixtureCommits,
  CONVERSATION_FIXTURE_URL,
} from '../src/testing/conversation-fixture.js';

describe('Durable conversation fixture', () => {
  it('matches the commits the Go CLI E2E test replays', async () => {
    // Arrange
    const committed: unknown = JSON.parse(
      await readFile(CONVERSATION_FIXTURE_URL, 'utf8'),
    );

    // Act
    const generated: unknown = JSON.parse(
      JSON.stringify(await buildConversationFixtureCommits()),
    );

    // Assert
    expect(
      generated,
      'apps/moltnet-cli/testdata/durable-conversation-commits.json is stale; ' +
        'run `pnpm exec nx run @moltnet/bootstrap:generate:durable-fixture`',
    ).toEqual(committed);
  });
});
