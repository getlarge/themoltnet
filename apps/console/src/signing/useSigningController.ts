import {
  approveSigningCredential,
  beginSigningCredentialRegistration,
  claimSigningRequest,
  completeSigningCredentialRegistration,
  completeSigningRequest,
  rejectSigningRequest,
  revokeSigningCredential,
  type SigningCredential,
  type SigningRequest,
  suspendSigningCredential,
} from '@moltnet/api-client';
import {
  listSigningCredentialsOptions,
  listSigningRequestsOptions,
} from '@moltnet/api-client/query';
import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { getApiClient } from '../api.js';
import { getConfig } from '../config.js';
import { useTeam } from '../team/useTeam.js';
import {
  createSignerCompanionClient,
  type SignerCompanionClient,
} from './companion-client.js';

export type CompanionStatus = 'connecting' | 'connected' | 'unavailable';

export type SigningAction =
  | 'enroll'
  | 'sign'
  | 'reject'
  | 'approve'
  | 'suspend'
  | 'revoke'
  | null;

export interface SigningController {
  credentials: SigningCredential[];
  requests: SigningRequest[];
  isLoading: boolean;
  error: string | null;
  pendingAction: SigningAction;
  companionStatus: CompanionStatus;
  enroll(label: string): Promise<void>;
  sign(request: SigningRequest, credentialId: string): Promise<void>;
  reject(request: SigningRequest): Promise<void>;
  approve(credential: SigningCredential): Promise<void>;
  suspend(credential: SigningCredential): Promise<void>;
  revoke(credential: SigningCredential): Promise<void>;
  refresh(): Promise<void>;
}

export function useSigningController(): SigningController {
  const { selectedTeam } = useTeam();
  const teamId = selectedTeam?.id;
  const [pendingAction, setPendingAction] = useState<SigningAction>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [companionStatus, setCompanionStatus] =
    useState<CompanionStatus>('connecting');
  const companion = useMemo(
    () =>
      createSignerCompanionClient({
        baseUrl: getConfig().signerUrl,
      }),
    [],
  );
  const credentialsQuery = useQuery({
    ...listSigningCredentialsOptions({
      client: getApiClient(),
      headers: { 'x-moltnet-team-id': teamId ?? '' },
      query: { limit: 100 },
    }),
    enabled: Boolean(teamId),
  });
  const requestsQuery = useQuery({
    ...listSigningRequestsOptions({
      client: getApiClient(),
      query: {
        limit: 100,
        scope: 'signable',
        status: ['pending', 'claimed'],
      },
    }),
    enabled: Boolean(teamId),
  });

  useEffect(() => {
    let active = true;
    setCompanionStatus('connecting');
    companion
      .connect()
      .then(() => {
        if (active) setCompanionStatus('connected');
      })
      .catch(() => {
        if (active) setCompanionStatus('unavailable');
      });
    return () => {
      active = false;
    };
  }, [companion]);

  const refresh = useCallback(async () => {
    await Promise.all([credentialsQuery.refetch(), requestsQuery.refetch()]);
  }, [credentialsQuery, requestsQuery]);

  const run = useCallback(
    async (action: Exclude<SigningAction, null>, task: () => Promise<void>) => {
      setPendingAction(action);
      setActionError(null);
      try {
        await task();
        await refresh();
      } catch (error) {
        setActionError(errorMessage(error));
        throw error;
      } finally {
        setPendingAction(null);
      }
    },
    [refresh],
  );

  const enroll = useCallback(
    async (label: string) =>
      run('enroll', async () => {
        if (!teamId) throw new Error('Select a team before enrolling');
        const popup = openCompanionWindow();
        try {
          const enrollment = await companion.createCeremony({
            version: 1,
            operation: 'credential-enrollment',
            label,
            teamId,
          });
          navigatePopup(popup, enrollment.approvalUrl);
          const enrollmentResult = await completedResult(
            companion,
            enrollment.id,
          );
          if (
            enrollmentResult.status !== 'completed' ||
            enrollmentResult.operation !== 'credential-enrollment'
          ) {
            throw new Error('Credential enrollment did not complete');
          }
          const registrationResponse = await beginSigningCredentialRegistration(
            {
              client: getApiClient(),
              headers: { 'x-moltnet-team-id': teamId },
              body: {
                verificationMethod: 'human-hardware-previewsign',
                credentialType: 'preview-sign-arkg',
                algorithm: 'arkg-p256-esp256',
                label,
                publicMaterial: enrollmentResult.publicMaterial,
              },
            },
          );
          const registration = requireData(
            registrationResponse,
            'Unable to begin credential registration',
          );
          if (popup.closed) {
            throw new Error(
              'Keep the signer window open to confirm registration',
            );
          }
          const proof = await companion.createCeremony({
            version: 1,
            operation: 'credential-registration',
            resourceId: registration.id,
            challenge: registration.challenge,
          });
          navigatePopup(popup, proof.approvalUrl);
          const proofResult = await completedResult(companion, proof.id);
          if (
            proofResult.status !== 'completed' ||
            proofResult.operation !== 'credential-registration'
          ) {
            throw new Error('Credential registration proof did not complete');
          }
          const completion = await completeSigningCredentialRegistration({
            client: getApiClient(),
            headers: { 'x-moltnet-team-id': teamId },
            path: { id: registration.id },
            body: {
              publicMaterial: enrollmentResult.publicMaterial,
              receipt: proofResult.receipt,
            },
          });
          requireData(completion, 'Unable to complete credential registration');
          popup.close();
        } catch (error) {
          popup.close();
          throw error;
        }
      }),
    [companion, run, teamId],
  );

  const sign = useCallback(
    async (request: SigningRequest, credentialId: string) =>
      run('sign', async () => {
        if (!teamId) throw new Error('Select a team before signing');
        const popup = openCompanionWindow();
        try {
          const claimResponse = await claimSigningRequest({
            client: getApiClient(),
            headers: { 'x-moltnet-team-id': teamId },
            path: { id: request.id },
            body: { credentialId },
          });
          const claimed = requireData(
            claimResponse,
            'Unable to claim signing request',
          );
          if (
            claimed.verificationMethod !== 'human-hardware-previewsign' ||
            !claimed.challenge
          ) {
            throw new Error('Server did not return a previewSign challenge');
          }
          const ceremony = await companion.createCeremony({
            version: 1,
            operation: 'signing-request',
            resourceId: claimed.id,
            challenge: claimed.challenge,
          });
          navigatePopup(popup, ceremony.approvalUrl);
          const result = await completedResult(companion, ceremony.id);
          if (
            result.status !== 'completed' ||
            result.operation !== 'signing-request'
          ) {
            throw new Error('Signing ceremony did not complete');
          }
          const completion = await completeSigningRequest({
            client: getApiClient(),
            headers: { 'x-moltnet-team-id': teamId },
            path: { id: claimed.id },
            body: { receipt: result.receipt },
          });
          requireData(completion, 'Unable to complete signing request');
          popup.close();
        } catch (error) {
          popup.close();
          throw error;
        }
      }),
    [companion, run, teamId],
  );

  const reject = useCallback(
    async (request: SigningRequest) =>
      run('reject', async () => {
        if (!teamId) throw new Error('Select a team before rejecting');
        const response = await rejectSigningRequest({
          client: getApiClient(),
          headers: { 'x-moltnet-team-id': teamId },
          path: { id: request.id },
          body: { reason: 'Rejected in MoltNet Console' },
        });
        requireData(response, 'Unable to reject signing request');
      }),
    [run, teamId],
  );

  const lifecycle = useCallback(
    async (
      action: 'approve' | 'suspend' | 'revoke',
      credential: SigningCredential,
    ) =>
      run(action, async () => {
        if (!teamId) throw new Error('Select a team first');
        const operation =
          action === 'approve'
            ? approveSigningCredential
            : action === 'suspend'
              ? suspendSigningCredential
              : revokeSigningCredential;
        const response = await operation({
          client: getApiClient(),
          headers: { 'x-moltnet-team-id': teamId },
          path: { id: credential.id },
        });
        requireData(response, `Unable to ${action} signing credential`);
      }),
    [run, teamId],
  );

  return {
    credentials:
      credentialsQuery.data?.items.filter(
        (credential) =>
          credential.verificationMethod === 'human-hardware-previewsign',
      ) ?? [],
    requests:
      requestsQuery.data?.items.filter(
        (request) =>
          request.verificationMethod === 'human-hardware-previewsign' &&
          request.teamId === teamId,
      ) ?? [],
    isLoading: credentialsQuery.isLoading || requestsQuery.isLoading,
    error:
      actionError ??
      (credentialsQuery.error || requestsQuery.error
        ? 'Unable to load signing data'
        : null),
    pendingAction,
    companionStatus,
    enroll,
    sign,
    reject,
    approve: (credential) => lifecycle('approve', credential),
    suspend: (credential) => lifecycle('suspend', credential),
    revoke: (credential) => lifecycle('revoke', credential),
    refresh,
  };
}

async function completedResult(
  companion: SignerCompanionClient,
  ceremonyId: string,
) {
  const controller = new AbortController();
  const timeout = window.setTimeout(
    () => controller.abort(new Error('Signer ceremony timed out')),
    5 * 60 * 1000,
  );
  try {
    const result = await companion.waitForResult(ceremonyId, {
      signal: controller.signal,
    });
    if (result.status === 'failed') throw new Error(result.message);
    return result;
  } finally {
    window.clearTimeout(timeout);
  }
}

function openCompanionWindow(): Window {
  const popup = window.open('about:blank', 'moltnet-signer', 'popup');
  if (!popup) {
    throw new Error('Allow popups to review the signing action');
  }
  return popup;
}

function navigatePopup(popup: Window, approvalUrl: string): void {
  if (popup.closed) throw new Error('Signer approval window was closed');
  popup.location.replace(approvalUrl);
  popup.focus();
}

function requireData<T extends { data?: unknown; error?: unknown }>(
  result: T,
  fallback: string,
): NonNullable<T['data']> {
  if (result.error || result.data === undefined || result.data === null) {
    throw new Error(problemMessage(result.error) ?? fallback);
  }
  return result.data as NonNullable<T['data']>;
}

function problemMessage(value: unknown): string | undefined {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    const detail = (value as { detail?: unknown }).detail;
    if (typeof detail === 'string') return detail;
    const message = (value as { message?: unknown }).message;
    if (typeof message === 'string') return message;
  }
  return undefined;
}

function errorMessage(value: unknown): string {
  return value instanceof Error ? value.message : 'Signing action failed';
}
