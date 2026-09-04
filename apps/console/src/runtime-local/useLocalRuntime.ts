/**
 * Connection and state controller for the local agent server (#2062).
 * Pairing grants are process-scoped by the daemon and kept in sessionStorage,
 * so a browser restart or daemon restart requires fresh local approval.
 */
import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { abortableDelay } from '../abortable-delay.js';
import { getConfig } from '../config.js';
import {
  type AgentServerAgentView,
  type AgentServerClient,
  AgentServerClientError,
  type AgentServerStatus,
  type AgentServerSubscriptionLogin,
  type CreateAgentBody,
  createAgentServerClient,
  type PutProviderBody,
  type StartRunBody,
} from './agent-server-client.js';

export type LocalRuntimeStatus =
  | 'connecting'
  | 'unavailable'
  | 'degraded'
  | 'unpaired'
  | 'pairing'
  | 'connected';

const CLAIM_POLL_INTERVAL_MS = 1_000;
const CLAIM_TIMEOUT_MS = 120_000;
const DEFAULT_HTTPS_AGENT_SERVER_URL = 'https://127.0.0.1:17374';
const DEFAULT_HTTP_AGENT_SERVER_URL = 'http://127.0.0.1:17374';

function supportsLoopbackPna(): boolean {
  return (
    typeof Request !== 'undefined' && 'targetAddressSpace' in Request.prototype
  );
}

function tokenStorageKey(agentServerUrl: string): string {
  return `moltnet-agent-server-token::${agentServerUrl}`;
}

function readStoredToken(agentServerUrl: string): string | null {
  try {
    return sessionStorage.getItem(tokenStorageKey(agentServerUrl));
  } catch {
    return null;
  }
}

export interface LocalRuntimeController {
  status: LocalRuntimeStatus;
  agentServerUrl: string;
  data: AgentServerStatus | undefined;
  actionError: string | null;
  connectionError: string | null;
  pairingApprovalUrl: string | null;
  pair(): Promise<void>;
  retry(): Promise<void>;
  disconnect(): void;
  createAgent(body: CreateAgentBody): Promise<AgentServerAgentView>;
  putProvider(id: string, body: PutProviderBody): Promise<void>;
  deleteProvider(id: string): Promise<void>;
  startRun(body: StartRunBody): Promise<void>;
  stopRun(runId: string): Promise<void>;
  streamLogs: (
    runId: string,
    onLine: (line: string) => void,
    signal: AbortSignal,
  ) => Promise<void>;
  /** Live device-code/instruction info for an in-flight subscription login. */
  subscriptionLogin: AgentServerSubscriptionLogin | null;
  connectSubscription(providerId: string): Promise<void>;
  cancelSubscription(providerId: string): Promise<void>;
  discoverModels(providerId: string): Promise<string[]>;
}

export function useLocalRuntime(): LocalRuntimeController {
  const configuredAgentServerUrl = getConfig().agentServerUrl;
  const [agentServerUrl, setAgentServerUrl] = useState(
    configuredAgentServerUrl,
  );
  const tokenRef = useRef<string | null>(readStoredToken(agentServerUrl));
  const pairingAbortRef = useRef<AbortController | null>(null);
  const subscriptionAbortRef = useRef<AbortController | null>(null);
  const [status, setStatus] = useState<LocalRuntimeStatus>('connecting');
  const [actionError, setActionError] = useState<string | null>(null);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [pairingApprovalUrl, setPairingApprovalUrl] = useState<string | null>(
    null,
  );
  const [subscriptionLogin, setSubscriptionLogin] =
    useState<AgentServerSubscriptionLogin | null>(null);

  const client = useMemo(
    () =>
      createAgentServerClient({
        baseUrl: agentServerUrl,
        getToken: () => tokenRef.current,
      }),
    [agentServerUrl],
  );

  const persistToken = useCallback(
    (token: string | null) => {
      tokenRef.current = token;
      try {
        if (token)
          sessionStorage.setItem(tokenStorageKey(agentServerUrl), token);
        else sessionStorage.removeItem(tokenStorageKey(agentServerUrl));
      } catch {
        // Storage unavailable: keep the process-scoped token in this tab only.
      }
    },
    [agentServerUrl],
  );

  const probe = useCallback(async () => {
    setStatus('connecting');
    setConnectionError(null);
    const health = await client.health();
    if (health.status === 'unavailable') {
      if (
        agentServerUrl === DEFAULT_HTTPS_AGENT_SERVER_URL &&
        supportsLoopbackPna()
      ) {
        const fallback = createAgentServerClient({
          baseUrl: DEFAULT_HTTP_AGENT_SERVER_URL,
          getToken: () => tokenRef.current,
        });
        const fallbackHealth = await fallback.health();
        if (fallbackHealth.status === 'ok') {
          setAgentServerUrl(DEFAULT_HTTP_AGENT_SERVER_URL);
          return;
        }
      }
      setConnectionError(
        health.reason === 'timeout'
          ? 'The local supervisor health check timed out.'
          : 'The local supervisor could not be reached.',
      );
      setStatus('unavailable');
      return;
    }
    if (health.status === 'incompatible') {
      setConnectionError(
        `The local supervisor health check returned HTTP ${health.httpStatus}.`,
      );
      setStatus('degraded');
      return;
    }
    if (!tokenRef.current) {
      setStatus('unpaired');
      return;
    }
    try {
      await client.status();
      setStatus('connected');
    } catch (error) {
      if (isUnauthorized(error)) {
        persistToken(null);
        setStatus('unpaired');
      } else {
        setConnectionError(errorMessage(error));
        setStatus('degraded');
      }
    }
  }, [client, persistToken]);

  useEffect(() => {
    void probe();
    return () => {
      pairingAbortRef.current?.abort();
      subscriptionAbortRef.current?.abort();
    };
  }, [probe]);

  const statusQuery = useQuery({
    queryKey: ['local-runtime', 'status', agentServerUrl],
    queryFn: () => client.status(),
    enabled: status === 'connected',
    refetchInterval: 5_000,
    retry: false,
  });

  useEffect(() => {
    if (!statusQuery.error) return;
    if (isUnauthorized(statusQuery.error)) {
      persistToken(null);
      setStatus('unpaired');
      return;
    }
    setConnectionError(errorMessage(statusQuery.error));
    setStatus('degraded');
  }, [statusQuery.error, persistToken]);

  const pair = useCallback(async () => {
    pairingAbortRef.current?.abort();
    const controller = new AbortController();
    pairingAbortRef.current = controller;
    const popup = window.open('about:blank', '_blank', 'popup');
    setActionError(null);
    setConnectionError(null);
    setPairingApprovalUrl(null);
    setStatus('pairing');
    try {
      const { pairingId, approvalPath } = await client.startPairing();
      controller.signal.throwIfAborted();
      const approvalUrl = client.approvalUrl(approvalPath);
      setPairingApprovalUrl(approvalUrl);
      if (popup && !popup.closed) {
        popup.location.replace(approvalUrl);
        popup.focus();
      } else {
        setActionError('Popup blocked. Open the approval page below.');
      }
      const token = await claimApprovedPairing(
        client,
        pairingId,
        controller.signal,
      );
      controller.signal.throwIfAborted();
      persistToken(token);
      setPairingApprovalUrl(null);
      setActionError(null);
      setStatus('connected');
      popup?.close();
    } catch (error) {
      popup?.close();
      if (controller.signal.aborted) return;
      setActionError(errorMessage(error, 'Pairing failed'));
      await probe();
    } finally {
      if (pairingAbortRef.current === controller) {
        pairingAbortRef.current = null;
      }
    }
  }, [client, persistToken, probe]);

  const connectSubscription = useCallback(
    async (providerId: string) => {
      subscriptionAbortRef.current?.abort();
      const controller = new AbortController();
      subscriptionAbortRef.current = controller;
      setActionError(null);
      try {
        // No window.open here: after an await we are outside the click
        // gesture and popup blockers (Safari especially) silently eat it.
        // The page renders an explicit "Open sign-in page" link instead.
        let login = await client.startSubscriptionLogin(
          providerId,
          controller.signal,
        );
        controller.signal.throwIfAborted();
        setSubscriptionLogin(login);
        if (login.status === 'failed') {
          setActionError(login.error ?? 'Subscription login failed');
          return;
        }
        const deadline = Date.now() + 5 * 60_000;
        while (login.status === 'pending' && Date.now() < deadline) {
          await abortableDelay(2_000, controller.signal);
          login = await client.subscriptionLoginStatus(
            providerId,
            controller.signal,
          );
          controller.signal.throwIfAborted();
          setSubscriptionLogin(login);
        }
        if (login.status === 'failed') {
          setActionError(login.error ?? 'Subscription login failed');
        }
        if (login.status !== 'pending') {
          await statusQuery.refetch();
          if (login.status === 'completed') setSubscriptionLogin(null);
        }
      } catch (error) {
        if (controller.signal.aborted) return;
        setActionError(
          error instanceof Error ? error.message : 'Subscription login failed',
        );
        setSubscriptionLogin(null);
      } finally {
        if (subscriptionAbortRef.current === controller) {
          subscriptionAbortRef.current = null;
        }
      }
    },
    [client, statusQuery],
  );

  const cancelSubscription = useCallback(
    async (providerId: string) => {
      subscriptionAbortRef.current?.abort();
      subscriptionAbortRef.current = null;
      setActionError(null);
      try {
        await client.cancelSubscriptionLogin(providerId);
        setSubscriptionLogin(null);
        await statusQuery.refetch();
      } catch (error) {
        if (error instanceof AgentServerClientError && error.status === 404) {
          setSubscriptionLogin(null);
          await statusQuery.refetch();
          return;
        }
        // Keep the pending state visible: clearing it would claim cancellation
        // succeeded while the server may still own a live OAuth flow.
        setActionError(errorMessage(error, 'Could not cancel sign-in'));
      }
    },
    [client, statusQuery],
  );

  const disconnect = useCallback(() => {
    pairingAbortRef.current?.abort();
    subscriptionAbortRef.current?.abort();
    persistToken(null);
    setPairingApprovalUrl(null);
    setSubscriptionLogin(null);
    setActionError(null);
    setConnectionError(null);
    setStatus('unpaired');
  }, [persistToken]);

  const refetchStatus = statusQuery.refetch;
  // Generic on purpose: createAgent needs the created view back (executor
  // escalation), while every mutation still reconciles the status query —
  // including after failures, before the operator retries.
  const runAction = async <T>(action: () => Promise<T>): Promise<T> => {
    setActionError(null);
    try {
      const result = await action();
      await refetchStatus();
      return result;
    } catch (error) {
      // Reconcile before the operator retries a failed mutation.
      await refetchStatus();
      setActionError(errorMessage(error, 'Request failed'));
      throw error;
    }
  };

  const streamLogs = useCallback(
    (runId: string, onLine: (line: string) => void, signal: AbortSignal) =>
      client.streamLogs(runId, onLine, signal),
    [client],
  );

  return {
    status,
    agentServerUrl,
    data: statusQuery.data,
    actionError,
    connectionError,
    pairingApprovalUrl,
    pair,
    retry: probe,
    disconnect,
    createAgent: (body) => runAction(() => client.createAgent(body)),
    putProvider: (id, body) =>
      runAction(() => client.putProvider(id, body)).then(() => undefined),
    deleteProvider: (id) => runAction(() => client.deleteProvider(id)),
    startRun: (body) =>
      runAction(() => client.startRun(body)).then(() => undefined),
    stopRun: (runId) => runAction(() => client.stopRun(runId)),
    streamLogs,
    subscriptionLogin,
    connectSubscription,
    cancelSubscription,
    discoverModels: (providerId) => client.discoverModels(providerId),
  };
}

async function claimApprovedPairing(
  client: AgentServerClient,
  pairingId: string,
  signal: AbortSignal,
): Promise<string> {
  const deadline = Date.now() + CLAIM_TIMEOUT_MS;
  for (;;) {
    await abortableDelay(CLAIM_POLL_INTERVAL_MS, signal);
    try {
      const { token } = await client.claimPairing(pairingId);
      return token;
    } catch (error) {
      const pending =
        error instanceof AgentServerClientError &&
        (error.code === 'pairing_not_approved' || error.status === 401);
      if (!pending) throw error;
      if (Date.now() >= deadline) {
        throw new Error('Pairing approval timed out. Start again to retry.');
      }
    }
  }
}

function isUnauthorized(error: unknown): boolean {
  return error instanceof AgentServerClientError && error.status === 401;
}

function errorMessage(error: unknown, fallback = 'Connection failed'): string {
  return error instanceof Error ? error.message : fallback;
}
