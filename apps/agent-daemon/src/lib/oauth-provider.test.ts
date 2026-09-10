import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ModelRuntime } from '@earendil-works/pi-coding-agent';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { OAuthProviderService } from './oauth-provider.js';

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

function authPath(): string {
  const root = mkdtempSync(join(tmpdir(), 'oauth-provider-'));
  cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  return join(root, 'pi', 'auth.json');
}

function runtime(overrides: Partial<ModelRuntime> = {}): ModelRuntime {
  return {
    getProviders: () => [
      { id: 'anthropic', name: 'Anthropic', auth: { oauth: {} } },
      { id: 'openai-codex', name: 'OpenAI Codex', auth: { oauth: {} } },
      { id: 'github-copilot', name: 'GitHub Copilot', auth: { oauth: {} } },
      { id: 'key-only', name: 'Key only', auth: { apiKey: {} } },
    ],
    login: vi.fn().mockResolvedValue({}),
    logout: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as ModelRuntime;
}

const interaction = {
  notify: () => undefined,
  prompt: () => Promise.resolve(''),
};

describe('OAuthProviderService', () => {
  it('lists Pi OAuth providers dynamically and excludes GitHub Copilot', async () => {
    const service = await OAuthProviderService.create({
      authPath: authPath(),
      modelRuntime: runtime(),
    });

    expect(service.list()).toEqual([
      { id: 'anthropic', name: 'Anthropic', connected: false },
      { id: 'openai-codex', name: 'OpenAI Codex', connected: false },
    ]);
  });

  it('uses ModelRuntime for login and logout', async () => {
    const loginCheck = vi.fn().mockResolvedValue({});
    const logoutCheck = vi.fn().mockResolvedValue(undefined);
    const modelRuntime = runtime({
      login: loginCheck,
      logout: logoutCheck,
    });
    const service = await OAuthProviderService.create({
      authPath: authPath(),
      modelRuntime,
    });

    await service.login('anthropic', interaction);
    await service.logout('anthropic');

    expect(loginCheck).toHaveBeenCalledWith('anthropic', 'oauth', interaction);
    expect(logoutCheck).toHaveBeenCalledWith('anthropic');
  });

  it('serializes same-provider OAuth operations across service instances', async () => {
    const path = authPath();
    let finish!: () => void;
    let markFirstStarted!: () => void;
    const firstStarted = new Promise<void>((resolve) => {
      markFirstStarted = resolve;
    });
    const firstRuntime = runtime({
      login: vi.fn(() => {
        markFirstStarted();
        return new Promise((resolve) => {
          finish = () => {
            resolve({});
          };
        });
      }),
    });
    const logoutCheck = vi.fn().mockResolvedValue(undefined);
    const secondRuntime = runtime({ logout: logoutCheck });
    const first = await OAuthProviderService.create({
      authPath: path,
      modelRuntime: firstRuntime,
    });
    const second = await OAuthProviderService.create({
      authPath: path,
      modelRuntime: secondRuntime,
    });

    const loggingIn = first.login('anthropic', interaction);
    await firstStarted;
    const loggingOut = second.logout('anthropic');
    await new Promise((resolve) => {
      setTimeout(resolve, 30);
    });
    expect(logoutCheck).not.toHaveBeenCalled();
    finish();
    await Promise.all([loggingIn, loggingOut]);
    expect(logoutCheck).toHaveBeenCalledOnce();
  });
});
