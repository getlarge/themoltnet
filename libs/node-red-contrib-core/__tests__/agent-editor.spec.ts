import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

import { describe, expect, it, vi } from 'vitest';

interface EditorDefinition {
  oneditprepare(this: Record<string, unknown>): void;
}

function loadEditor(initialAuthType: string): {
  definition: EditorDefinition;
  authType: () => string;
} {
  const html = readFileSync(
    new URL('../src/nodes/agent.html', import.meta.url),
    'utf8',
  );
  const script = html.match(
    /<script type="text\/javascript">([\s\S]*?)<\/script>/u,
  )?.[1];
  if (!script) throw new Error('agent editor script is missing');

  let definition: EditorDefinition | undefined;
  let selectedAuthType = initialAuthType;
  const changeHandlers: Array<() => void> = [];
  const $ = vi.fn((selector: string) => ({
    val(value?: string) {
      if (value !== undefined) {
        selectedAuthType = value;
        return this;
      }
      return selectedAuthType;
    },
    on(event: string, handler: () => void) {
      if (selector === '#node-config-input-authType' && event === 'change') {
        changeHandlers.push(handler);
      }
      return this;
    },
    toggle: vi.fn(),
  }));
  const RED = {
    nodes: {
      registerType(_name: string, registered: EditorDefinition) {
        definition = registered;
      },
    },
  };

  runInNewContext(script, { $, RED });
  if (!definition) throw new Error('agent editor did not register');
  return {
    definition,
    authType: () => selectedAuthType,
  };
}

describe('moltnet-agent editor migration', () => {
  it('keeps legacy client-secret configurations in OAuth2 mode', () => {
    const editor = loadEditor('agentKey');

    editor.definition.oneditprepare.call({
      authType: 'agentKey',
      clientId: 'legacy-client',
      credentials: {
        has_clientSecret: true,
        has_agentKey: false,
      },
    });

    expect(editor.authType()).toBe('oauth2');
  });

  it('keeps an explicitly saved agent-key configuration unchanged', () => {
    const editor = loadEditor('agentKey');

    editor.definition.oneditprepare.call({
      authType: 'agentKey',
      clientId: 'stale-client-id',
      credentials: {
        has_clientSecret: true,
        has_agentKey: true,
      },
    });

    expect(editor.authType()).toBe('agentKey');
  });
});
