import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MoltThemeProvider } from '@themoltnet/design-system';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SigningPage } from '../src/pages/SigningPage.js';

const enroll = vi.fn();
const sign = vi.fn();
const reject = vi.fn();
const approve = vi.fn();
const suspend = vi.fn();
const revoke = vi.fn();
const refresh = vi.fn();

const credential = {
  id: '880e8400-e29b-41d4-a716-446655440003',
  label: 'Operator YubiKey',
  status: 'active' as const,
  verificationMethod: 'human-hardware-previewsign' as const,
  createdAt: '2030-08-01T11:00:00.000Z',
};

const request = {
  id: '660e8400-e29b-41d4-a716-446655440001',
  purpose: 'Approve production deployment',
  message: 'bafybeigdyrzt5exampledeploymentcid',
  expiresAt: '2030-08-01T12:05:00.000Z',
  status: 'pending' as const,
  verificationMethod: 'human-hardware-previewsign' as const,
  requestedBy: { id: 'agent-1', type: 'agent' as const },
  signerConstraint: { id: 'manager', type: 'team-role' as const },
};

const controllerState = {
  credentials: [credential],
  requests: [request],
  isLoading: false,
  error: null as {
    code: string;
    message: string;
    remediation: string;
  } | null,
  pendingAction: null,
  companionStatus: 'connected' as 'connected' | 'connecting' | 'unavailable',
  enroll,
  sign,
  reject,
  approve,
  suspend,
  revoke,
  refresh,
};

vi.mock('../src/signing/useSigningController.js', () => ({
  useSigningController: () => controllerState,
}));

vi.mock('../src/team/useTeam.js', () => ({
  useTeam: () => ({
    selectedTeam: {
      id: '770e8400-e29b-41d4-a716-446655440002',
      name: 'Production',
      role: 'owner',
    },
  }),
}));

function Wrapper({ children }: { children: ReactNode }) {
  return <MoltThemeProvider mode="dark">{children}</MoltThemeProvider>;
}

describe('SigningPage', () => {
  beforeEach(() => {
    controllerState.error = null;
    controllerState.companionStatus = 'connected';
    for (const mock of [
      enroll,
      sign,
      reject,
      approve,
      suspend,
      revoke,
      refresh,
    ]) {
      mock.mockReset();
      mock.mockResolvedValue(undefined);
    }
  });

  it('makes the exact action, requester, method, and expiry scannable', () => {
    render(<SigningPage />, { wrapper: Wrapper });

    expect(
      screen.getByRole('heading', { name: 'Signing' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Approve production deployment')).toBeVisible();
    expect(screen.getByText('agent-1')).toBeVisible();
    expect(screen.getAllByText('human-hardware-previewsign')[0]).toBeVisible();
    expect(screen.getByText('team-role: manager')).toBeVisible();
    expect(screen.getByText('pending')).toBeVisible();
    expect(screen.getByText(/expires/i)).toBeVisible();
    expect(screen.getByText('Companion connected')).toBeVisible();
  });

  it('requires explicit review before opening the companion ceremony', async () => {
    render(<SigningPage />, { wrapper: Wrapper });

    fireEvent.click(
      screen.getByRole('button', { name: 'Review and sign request' }),
    );
    const signButton = screen.getByRole('button', {
      name: 'Sign exact action',
    });
    expect(signButton).toBeDisabled();
    expect(
      screen.getByText('Approve production deployment', {
        selector: '[data-signing-action]',
      }),
    ).toBeVisible();

    fireEvent.click(
      screen.getByRole('checkbox', {
        name: /I reviewed this exact action and its expiry/i,
      }),
    );
    expect(signButton).toBeEnabled();
    fireEvent.click(signButton);

    await waitFor(() => {
      expect(sign).toHaveBeenCalledWith(request, credential.id);
    });
  });

  it('offers reject without device access and lifecycle actions only to managers', async () => {
    render(<SigningPage />, { wrapper: Wrapper });

    fireEvent.click(
      screen.getByRole('button', { name: 'Reject signing request' }),
    );
    await waitFor(() => expect(reject).toHaveBeenCalledWith(request));
    expect(sign).not.toHaveBeenCalled();

    fireEvent.click(
      screen.getByRole('button', { name: 'Suspend Operator YubiKey' }),
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Revoke Operator YubiKey' }),
    );
    expect(suspend).toHaveBeenCalledWith(credential);
    expect(revoke).toHaveBeenCalledWith(credential);
  });

  it('starts credential enrollment with a human-readable label', async () => {
    render(<SigningPage />, { wrapper: Wrapper });

    fireEvent.change(screen.getByLabelText('Credential label'), {
      target: { value: 'Deployment key' },
    });
    fireEvent.click(
      screen.getByRole('button', { name: 'Enroll signing credential' }),
    );

    await waitFor(() => expect(enroll).toHaveBeenCalledWith('Deployment key'));
  });

  it('announces a typed failure without removing the retryable request', () => {
    controllerState.error = {
      code: 'ceremony_expired',
      message: 'The signing challenge expired',
      remediation: 'Start the signing action again.',
    };

    render(<SigningPage />, { wrapper: Wrapper });

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Signing action stoppedThe signing challenge expiredStart the signing action again.Error code: ceremony_expired',
    );
    expect(screen.getByText('Approve production deployment')).toBeVisible();
    expect(
      screen.getByRole('button', { name: 'Review and sign request' }),
    ).toBeEnabled();
  });

  it('explains how to recover when the local companion is unavailable', () => {
    controllerState.companionStatus = 'unavailable';

    render(<SigningPage />, { wrapper: Wrapper });

    expect(screen.getByRole('status')).toHaveTextContent(
      'Companion unavailable',
    );
    expect(screen.getByText(/Start the local signer companion/i)).toBeVisible();
    fireEvent.click(
      screen.getByRole('button', { name: 'Check companion again' }),
    );
    expect(refresh).toHaveBeenCalledOnce();
    expect(
      screen.getByRole('button', { name: 'Review and sign request' }),
    ).toHaveAttribute('aria-describedby', 'companion-help');
  });
});
