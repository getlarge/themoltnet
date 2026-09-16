import { describe, expect, it } from 'vitest';

import {
  AgentServerModelDiscoveryError,
  MAX_DISCOVERED_MODELS,
  ModelDiscoveryCollector,
  parseProviderBaseUrl,
} from './model-discovery.js';

function expectDiscoveryCode(run: () => unknown, code: string): void {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(AgentServerModelDiscoveryError);
    if (!(error instanceof AgentServerModelDiscoveryError)) throw error;
    expect(error.code).toBe(code);
    return;
  }
  throw new Error(`Expected model discovery to fail with ${code}`);
}

describe('provider model discovery protocol', () => {
  it('parses OpenAI and Ollama payloads, deduplicates, sorts, and bounds models', () => {
    const collector = new ModelDiscoveryCollector();
    collector.addOpenAiResponse({
      data: Array.from(
        { length: MAX_DISCOVERED_MODELS + 25 },
        (_value, index) => ({ id: `model-${String(index).padStart(4, '0')}` }),
      ),
    });
    collector.addOllamaResponse({
      models: [{ name: 'model-0000' }, { name: 'another-model' }],
    });

    const result = collector.result('ollama', []);

    expect(result.discoveredCount).toBe(MAX_DISCOVERED_MODELS + 26);
    expect(result.models).toHaveLength(MAX_DISCOVERED_MODELS);
    expect(result.models[0]).toEqual({ id: 'another-model' });
    expect(new Set(result.models.map((model) => model.id)).size).toBe(
      result.models.length,
    );
  });

  it('lets a later probe overwrite a modality an earlier response recorded', () => {
    const collector = new ModelDiscoveryCollector();
    collector.addOllamaResponse({
      models: [{ name: 'x', capabilities: ['completion'] }],
    });

    expect(collector.result('ollama', []).models).toEqual([{ id: 'x' }]);

    // A probe answering later must win: "first write wins" would strip the
    // capability and silently leave a vision model text-only.
    collector.setModalities('x', ['text', 'image']);

    expect(collector.result('ollama', []).models).toEqual([
      { id: 'x', input: ['text', 'image'] },
    ]);
  });

  it('keeps an id-only sighting from erasing modalities already recorded', () => {
    const collector = new ModelDiscoveryCollector();
    collector.addOllamaResponse({
      models: [{ name: 'shared', capabilities: ['vision'] }],
    });
    // /v1/models lists the same id without capabilities; the overlap must not
    // downgrade what /api/tags already answered.
    collector.addOpenAiResponse({ data: [{ id: 'shared' }] });

    const result = collector.result('ollama', []);
    expect(result.models).toEqual([{ id: 'shared', input: ['text', 'image'] }]);
    expect(result.unresolved).toEqual([]);
  });

  it('classifies authorization, network, invalid-response, and empty failures', () => {
    const result = () => new ModelDiscoveryCollector();

    expectDiscoveryCode(
      () => result().result('provider', [{ kind: 'http', status: 401 }]),
      'discovery_unauthorized',
    );
    expectDiscoveryCode(
      () =>
        result().result('provider', [
          { kind: 'network', errorType: 'TimeoutError' },
        ]),
      'discovery_unavailable',
    );
    expectDiscoveryCode(
      () => result().result('provider', [{ kind: 'invalid_response' }]),
      'discovery_invalid_response',
    );
    expectDiscoveryCode(
      () => result().result('provider', []),
      'discovery_failed',
    );
  });

  it('rejects credential-bearing and non-http provider URLs', () => {
    for (const value of [
      'https://user:secret@provider.example/v1',
      'https://provider.example/v1?api_key=secret',
      'https://provider.example/v1#secret',
      'file:///tmp/models',
    ]) {
      expectDiscoveryCode(
        () => parseProviderBaseUrl(value, 'provider'),
        'invalid_provider',
      );
    }
  });
});
