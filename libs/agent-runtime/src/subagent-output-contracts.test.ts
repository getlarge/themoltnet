import { Type } from '@sinclair/typebox';
import { describe, expect, it } from 'vitest';

import {
  createSubagentContractRegistry,
  type SubagentOutputContract,
} from './subagent-output-contracts.js';

const sampleSchema = Type.Object({
  verdict: Type.String(),
  score: Type.Number({ minimum: 0, maximum: 1 }),
});

const make = (
  overrides?: Partial<SubagentOutputContract>,
): SubagentOutputContract => ({
  name: 'sample_contract',
  description: 'A sample contract for tests.',
  parametersSchema: sampleSchema,
  ...overrides,
});

describe('subagent contract registry', () => {
  it('registers and retrieves by name via .get()', () => {
    const contracts = [make({ name: 'test_contract' })];
    const registry = createSubagentContractRegistry(contracts);
    expect(registry.get('test_contract')).toBe(contracts[0]);
  });

  it('returns null for unknown names', () => {
    const registry = createSubagentContractRegistry([]);
    expect(registry.get('no_such_thing')).toBeNull();
  });

  it('list() returns every registered contract', () => {
    const a = make({ name: 'one' });
    const b = make({ name: 'two' });
    const registry = createSubagentContractRegistry([a, b]);
    const listed = registry.list();
    expect(listed).toHaveLength(2);
    expect(listed).toContain(a);
    expect(listed).toContain(b);
  });

  it('rejects an empty name', () => {
    expect(() =>
      createSubagentContractRegistry([make({ name: '' })]),
    ).toThrow('name is required');
  });

  it('rejects names that are not lower_snake_case', () => {
    expect(() =>
      createSubagentContractRegistry([make({ name: 'CamelCase' })]),
    ).toThrow(/lower_snake_case/);
    expect(() =>
      createSubagentContractRegistry([make({ name: 'has-dashes' })]),
    ).toThrow(/lower_snake_case/);
    expect(() =>
      createSubagentContractRegistry([make({ name: 'has spaces' })]),
    ).toThrow(/lower_snake_case/);
    expect(() =>
      createSubagentContractRegistry([make({ name: '1starts_with_digit' })]),
    ).toThrow(/lower_snake_case/);
  });

  it('accepts valid lower_snake_case names', () => {
    const registry = createSubagentContractRegistry([
      make({ name: 'good_name' }),
      make({ name: 'with_digits_2_inside' }),
    ]);
    expect(registry.get('good_name')).toBeDefined();
    expect(registry.get('with_digits_2_inside')).toBeDefined();
  });

  it('rejects duplicate contract names', () => {
    expect(() =>
      createSubagentContractRegistry([
        make({ name: 'dup' }),
        make({ name: 'dup' }),
      ]),
    ).toThrow(/duplicate.*name.*'dup'/);
  });

  it('is immutable after construction — list() cannot mutate internal state', () => {
    const contracts = [make({ name: 'immutable' })];
    const registry = createSubagentContractRegistry(contracts);
    const listed = registry.list();
    // Mutating the returned array should not affect subsequent list() calls.
    (listed as SubagentOutputContract[]).length = 0;
    expect(registry.list()).toHaveLength(1);
  });
});
