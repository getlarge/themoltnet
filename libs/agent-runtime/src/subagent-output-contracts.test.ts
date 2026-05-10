import { Type } from '@sinclair/typebox';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  __resetSubagentOutputContractsForTests,
  getSubagentOutputContract,
  listSubagentOutputContracts,
  registerSubagentOutputContract,
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

describe('subagent output contract registry', () => {
  beforeEach(() => {
    __resetSubagentOutputContractsForTests();
  });

  it('registers and retrieves by name', () => {
    const c = make();
    registerSubagentOutputContract(c);
    expect(getSubagentOutputContract('sample_contract')).toBe(c);
  });

  it('returns null for unknown names', () => {
    expect(getSubagentOutputContract('no_such_thing')).toBeNull();
  });

  it('listSubagentOutputContracts returns every registered contract', () => {
    const a = make({ name: 'one' });
    const b = make({ name: 'two' });
    registerSubagentOutputContract(a);
    registerSubagentOutputContract(b);
    const listed = listSubagentOutputContracts();
    expect(listed).toHaveLength(2);
    expect(listed).toContain(a);
    expect(listed).toContain(b);
  });

  it('allows re-registering the identical contract object (HMR-safe)', () => {
    const c = make();
    registerSubagentOutputContract(c);
    expect(() => registerSubagentOutputContract(c)).not.toThrow();
  });

  it('allows re-registering the same name with the same schema reference', () => {
    // Different object literal, same parametersSchema reference.
    const c1 = make();
    const c2: SubagentOutputContract = { ...c1 };
    registerSubagentOutputContract(c1);
    expect(() => registerSubagentOutputContract(c2)).not.toThrow();
  });

  it('refuses re-registration with a different schema reference', () => {
    registerSubagentOutputContract(make());
    expect(() =>
      registerSubagentOutputContract(
        make({ parametersSchema: Type.Object({ different: Type.String() }) }),
      ),
    ).toThrow(/already registered with a different schema/);
  });

  it('rejects an empty name', () => {
    expect(() => registerSubagentOutputContract(make({ name: '' }))).toThrow(
      /name is required/,
    );
  });

  it('rejects names that are not lower_snake_case', () => {
    expect(() =>
      registerSubagentOutputContract(make({ name: 'CamelCase' })),
    ).toThrow(/lower_snake_case/);
    expect(() =>
      registerSubagentOutputContract(make({ name: 'has-dashes' })),
    ).toThrow(/lower_snake_case/);
    expect(() =>
      registerSubagentOutputContract(make({ name: 'has spaces' })),
    ).toThrow(/lower_snake_case/);
    expect(() =>
      registerSubagentOutputContract(make({ name: '1starts_with_digit' })),
    ).toThrow(/lower_snake_case/);
  });

  it('accepts valid lower_snake_case names', () => {
    expect(() =>
      registerSubagentOutputContract(make({ name: 'good_name' })),
    ).not.toThrow();
    expect(() =>
      registerSubagentOutputContract(make({ name: 'with_digits_2_inside' })),
    ).not.toThrow();
  });
});
