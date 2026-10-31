import { describe, expect, it } from 'vitest';

import {
  getUniqueViolationConstraint,
  translateUniqueViolation,
  UniqueViolationError,
} from '../src/unique-violation.js';

describe('unique violation helpers', () => {
  it('extracts the constraint from a nested pg unique violation', () => {
    const pgError = Object.assign(new Error('duplicate key'), {
      code: '23505',
      constraint: 'runtime_models_team_uq',
    });
    const drizzleError = Object.assign(new Error('Failed query'), {
      cause: pgError,
    });

    expect(getUniqueViolationConstraint(drizzleError)).toBe(
      'runtime_models_team_uq',
    );
  });

  it('returns null for non-unique pg errors', () => {
    const pgError = Object.assign(new Error('fk violation'), {
      code: '23503',
      constraint: 'runtime_models_team_fk',
    });

    expect(getUniqueViolationConstraint(pgError)).toBeNull();
  });

  it('returns null when the constraint field is missing', () => {
    const pgError = Object.assign(new Error('duplicate key'), {
      code: '23505',
    });

    expect(getUniqueViolationConstraint(pgError)).toBeNull();
  });

  it('translates only matching constraints into UniqueViolationError', () => {
    const pgError = Object.assign(new Error('duplicate key'), {
      code: '23505',
      constraint: 'runtime_models_team_uq',
    });

    const translated = translateUniqueViolation(pgError, {
      constraint: 'runtime_models_team_uq',
      target: {
        resource: 'runtime-model',
        keys: {
          teamId: 'team-1',
          provider: 'anthropic',
          model: 'claude-sonnet-4-5',
        },
      },
    });

    expect(translated).toBeInstanceOf(UniqueViolationError);
    expect(translated).toMatchObject({
      constraint: 'runtime_models_team_uq',
      target: {
        resource: 'runtime-model',
        keys: {
          teamId: 'team-1',
          provider: 'anthropic',
          model: 'claude-sonnet-4-5',
        },
      },
    });
  });

  it('misses non-matching constraints', () => {
    const pgError = Object.assign(new Error('duplicate key'), {
      code: '23505',
      constraint: 'runtime_models_team_uq',
    });

    expect(
      translateUniqueViolation(pgError, {
        constraint: 'runtime_profiles_team_name_idx',
      }),
    ).toBeNull();
  });
});
