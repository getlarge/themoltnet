import { beforeAll, describe, expect, it, vi } from 'vitest';

// ── DBOS Mock (vi.hoisted for proper hoisting) ────────────────

const { mockRegisterStep, mockRegisterWorkflow, mockLogger } = vi.hoisted(
  () => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
    const mockRegisterStep = vi.fn((fn: Function) => fn);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
    const mockRegisterWorkflow = vi.fn((fn: Function) => fn);
    const mockLogger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
    return { mockRegisterStep, mockRegisterWorkflow, mockLogger };
  },
);

vi.mock('@moltnet/database', async (importOriginal) => {
  const original = (await importOriginal()) as Record<string, unknown>;
  return {
    ...original,
    DBOS: {
      registerStep: mockRegisterStep,
      registerWorkflow: mockRegisterWorkflow,
      logger: mockLogger,
    },
  };
});

// ── Imports (after mock) ──────────────────────────────────────

import {
  initLegreffierOnboardingWorkflow,
  legreffierOnboardingWorkflow,
  OnboardingTimeoutError,
  OnboardingWorkflowError,
  setLegreffierOnboardingDeps,
} from '../../src/workflows/index.js';

// ── Mock Dependencies ─────────────────────────────────────────

function createMockDeps() {
  return {
    voucherRepository: {
      issueUnlimited: vi.fn(),
    },
    identityApi: {
      deleteIdentity: vi.fn(),
    },
  };
}

// ── Tests ─────────────────────────────────────────────────────

describe('initLegreffierOnboardingWorkflow', () => {
  beforeAll(() => {
    initLegreffierOnboardingWorkflow();
  });

  it('registers steps and workflow with DBOS', () => {
    expect(mockRegisterStep).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({ name: 'legreffier.step.issueVoucher' }),
    );
    expect(mockRegisterStep).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({
        name: 'legreffier.step.deleteKratosIdentity',
      }),
    );
    expect(mockRegisterWorkflow).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({ name: 'legreffier.startOnboarding' }),
    );
  });

  it('is idempotent — calling twice does not re-register', () => {
    const callsBefore = mockRegisterWorkflow.mock.calls.length;
    initLegreffierOnboardingWorkflow();
    expect(mockRegisterWorkflow.mock.calls.length).toBe(callsBefore);
  });
});

describe('setLegreffierOnboardingDeps', () => {
  it('sets deps without throwing', () => {
    const deps = createMockDeps();
    expect(() =>
      setLegreffierOnboardingDeps(
        deps as unknown as Parameters<typeof setLegreffierOnboardingDeps>[0],
      ),
    ).not.toThrow();
  });
});

describe('legreffierOnboardingWorkflow accessor', () => {
  it('exposes startOnboarding after initialization', () => {
    expect(legreffierOnboardingWorkflow.startOnboarding).toBeDefined();
    expect(typeof legreffierOnboardingWorkflow.startOnboarding).toBe(
      'function',
    );
  });
});

describe('OnboardingTimeoutError', () => {
  it('has correct name', () => {
    const err = new OnboardingTimeoutError('timed out');
    expect(err.name).toBe('OnboardingTimeoutError');
    expect(err.message).toBe('timed out');
    expect(err).toBeInstanceOf(Error);
  });
});

describe('OnboardingWorkflowError', () => {
  it('has correct name', () => {
    const err = new OnboardingWorkflowError('something failed');
    expect(err.name).toBe('OnboardingWorkflowError');
    expect(err).toBeInstanceOf(Error);
  });
});
