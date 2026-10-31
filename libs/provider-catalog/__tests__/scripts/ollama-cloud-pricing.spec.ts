import { describe, expect, it } from 'vitest';

import {
  parseOllamaCloudPricing,
  pricingForCapabilities,
} from '../../scripts/ollama-cloud-pricing.js';

const page = (rows: string) => `<section id="model-pricing"><table>
  <thead><tr><th>Model</th><th>Input</th><th>Cached input</th><th>Output</th></tr></thead>
  <tbody>${rows}</tbody></table></section>`;
const row = (model: string, input: string, cached: string, output: string) =>
  `<tr><td><a href="/library/model">${model}</a></td><td>${input}</td><td>${cached}</td><td>${output}</td></tr>`;

describe('Ollama Cloud pricing', () => {
  it('keeps standard and off-peak rates separate in USD per million tokens', () => {
    const prices = parseOllamaCloudPricing(
      page(
        row('test-model', '$0.30', '$0.006', '$1.20') +
          row('test-model (Off-Peak)', '$0.15', '$0.003', '$0.60'),
      ),
    );

    expect(prices.get('test-model')).toEqual({
      cost: { input: 0.3, output: 1.2, cacheRead: 0.006, cacheWrite: 0 },
      offPeakCost: {
        input: 0.15,
        output: 0.6,
        cacheRead: 0.003,
        cacheWrite: 0,
      },
    });
    expect(prices.size).toBe(1);
  });

  it('prices input-only classifiers apart from chat models', () => {
    const prices = parseOllamaCloudPricing(
      page(
        row('classifier', '$0.24', '-', '-') +
          row('chat', '$0.50', '-', '$1.50'),
      ),
    );

    expect(prices.get('classifier')).toEqual({
      classifierCost: {
        input: 0.24,
        output: 0,
        cacheRead: 0.24,
        cacheWrite: 0,
      },
    });
    expect(prices.get('chat')).toMatchObject({ cost: { cacheRead: 0.5 } });
  });

  it.each([
    '<html>pricing unavailable</html>',
    page(row('model', 'contact sales', '$0.01', '$1.00')),
    page(row('model (Off-Peak)', '$0.10', '$0.01', '$1.00')),
    page(row('<span>model</span>', '$0.10', '$0.01', '$1.00')),
    page(row('model', '<b>$0.10</b>', '$0.01', '$1.00')),
    page(''),
    page(row('classifier', '$0.24', '-', '-')),
  ])('rejects a missing or unparseable price table', (html) => {
    expect(() => parseOllamaCloudPricing(html)).toThrow();
  });

  describe('capability check', () => {
    const chat = {
      cost: { input: 0.5, output: 1.5, cacheRead: 0.5, cacheWrite: 0 },
    };
    const classifier = {
      classifierCost: {
        input: 0.24,
        output: 0,
        cacheRead: 0.24,
        cacheWrite: 0,
      },
    };

    it.each([
      [['decision', 'vision'], classifier],
      [['completion', 'tools'], chat],
      [['completion', 'decision'], chat],
      [['decision'], undefined],
    ])('accepts %j priced as %j', (capabilities, pricing) => {
      expect(pricingForCapabilities('model', capabilities, pricing)).toBe(
        pricing,
      );
    });

    it.each([
      [['completion', 'tools'], classifier],
      [['completion', 'decision'], classifier],
      [['decision', 'vision'], chat],
    ])('rejects %j priced as %j', (capabilities, pricing) => {
      expect(() =>
        pricingForCapabilities('model', capabilities, pricing),
      ).toThrow();
    });
  });
});
