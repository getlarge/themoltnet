import { describe, expect, it } from 'vitest';

import { handleSignMessage } from '../src/prompts.js';

function getPromptText(result: { messages: { content: unknown }[] }): string {
  return (result.messages[0].content as { type: string; text: string }).text;
}

describe('sign_message prompt', () => {
  it('embeds the message and signing steps', async () => {
    const result = await handleSignMessage({ message: 'hello world' });

    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].role).toBe('user');
    const text = getPromptText(result);
    expect(text).toContain('hello world');
    expect(text).toContain('crypto_prepare_signature');
    expect(text).toContain('crypto_submit_signature');
  });
});
