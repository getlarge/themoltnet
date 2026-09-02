import { describe, expect, it } from 'vitest';

import {
  MAX_DISCOVERED_MODELS,
  ModelDiscoveryCollector,
  parseProviderBaseUrl,
  ServeModelDiscoveryError,
} from './model-discovery.js';

function expectDiscoveryCode(run: () => unknown, code: string): void {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(ServeModelDiscoveryError);
    if (!(error instanceof ServeModelDiscoveryError)) throw error;
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
    expect(result.models[0]).toBe('another-model');
    expect(new Set(result.models).size).toBe(result.models.length);
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
