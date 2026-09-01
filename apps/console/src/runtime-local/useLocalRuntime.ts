/**
 * Connection + state controller for the local serve supervisor (#2062).
 *
 * Follows the signer's `connecting | connected | unavailable` companion
 * pattern, extended with the pairing states the serve ceremony needs. The
 * pairing token is a loopback-only capability kept in localStorage, scoped
 * per serve URL; the browser session never reaches the companion.
 */
import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { getConfig } from '../config.js';
import {
  type CreateAgentBody,
  createServeClient,
  type PutProviderBody,
  ServeClientError,
  type ServeStatus,
  type StartRunBody,
} from './serve-client.js';

export type LocalRuntimeStatus =
  | 'connecting'
  | 'unavailable'
  | 'unpaired'
  | 'pairing'
  | 'connected';

const CLAIM_POLL_INTERVAL_MS = 1_000;
const CLAIM_TIMEOUT_MS = 120_000;

function tokenStorageKey(serveUrl: string): string {
  return `moltnet-serve-token::${serveUrl}`;
}

function readStoredToken(serveUrl: string): string | null {
  try {
    return localStorage.getItem(tokenStorageKey(serveUrl));
  } catch {
    return null;
  }
}

export interface LocalRuntimeController {
  status: LocalRuntimeStatus;
  serveUrl: string;
  data: ServeStatus | undefined;
  actionError: string | null;
  pair(): Promise<void>;
  retry(): Promise<void>;
  disconnect(): void;
  createAgent(body: CreateAgentBody): Promise<void>;
  putProvider(id: string, body: PutProviderBody): Promise<void>;
  startRun(body: StartRunBody): Promise<void>;
  stopRun(runId: string): Promise<void>;
  streamLogs(
    runId: string,
    onLine: (line: string) => void,
    signal: AbortSignal,
  ): Promise<void>;
}

export function useLocalRuntime(): LocalRuntimeController {
  const serveUrl = getConfig().serveUrl;
  const tokenRef = useRef<string | null>(readStoredToken(serveUrl));
  const [status, setStatus] = useState<LocalRuntimeStatus>('connecting');
  const [actionError, setActionError] = useState<string | null>(null);

  const client = useMemo(
    () =>
      createServeClient({
        baseUrl: serveUrl,
        getToken: () => tokenRef.current,
      }),
    [serveUrl],
  );

  const persistToken = useCallback(
    (token: string | null) => {
      tokenRef.current = token;
      try {
        if (token) localStorage.setItem(tokenStorageKey(serveUrl), token);
        else localStorage.removeItem(tokenStorageKey(serveUrl));
      } catch {
        // storage unavailable: token lives for this tab only
      }
    },
    [serveUrl],
  );

  const probe = useCallback(async () => {
    setStatus('connecting');
    if (!(await client.health())) {
      setStatus('unavailable');
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
      if (error instanceof ServeClientError && error.status === 401) {
        persistToken(null);
        setStatus('unpaired');
      } else {
        setStatus('unavailable');
      }
    }
  }, [client, persistToken]);

  useEffect(() => {
    void probe();
  }, [probe]);

  const statusQuery = useQuery({
    queryKey: ['local-runtime', 'status', serveUrl],
    queryFn: () => client.status(),
    enabled: status === 'connected',
    refetchInterval: 5_000,
    retry: false,
  });
  const statusQueryError = statusQuery.error;
  useEffect(() => {
    if (
      statusQueryError instanceof ServeClientError &&
      statusQueryError.status === 401
    ) {
      persistToken(null);
      setStatus('unpaired');
    }
  }, [statusQueryError, persistToken]);

  const pair = useCallback(async () => {
    setActionError(null);
    setStatus('pairing');
    try {
      const { pairingId, approvalPath } = await client.startPairing();
      window.open(client.approvalUrl(approvalPath), '_blank', 'noopener');
      const deadline = Date.now() + CLAIM_TIMEOUT_MS;
      for (;;) {
        await new Promise((resolvePromise) => {
          setTimeout(resolvePromise, CLAIM_POLL_INTERVAL_MS);
        });
        try {
          const { token } = await client.claimPairing(pairingId);
          persistToken(token);
          setStatus('connected');
          return;
        } catch (error) {
          const notYet =
            error instanceof ServeClientError &&
            (error.code === 'pairing_not_approved' || error.status === 401);
          if (!notYet || Date.now() > deadline) throw error;
        }
      }
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Pairing failed');
      await probe();
    }
  }, [client, persistToken, probe]);

  const disconnect = useCallback(() => {
    persistToken(null);
    setStatus('unpaired');
  }, [persistToken]);

  const runAction = useCallback(
    async (action: () => Promise<unknown>) => {
      setActionError(null);
      try {
        await action();
        await statusQuery.refetch();
      } catch (error) {
        setActionError(
          error instanceof Error ? error.message : 'Request failed',
        );
        throw error;
      }
    },
    [statusQuery],
  );

  return {
    status,
    serveUrl,
    data: statusQuery.data,
    actionError,
    pair,
    retry: probe,
    disconnect,
    createAgent: (body) => runAction(() => client.createAgent(body)),
    putProvider: (id, body) => runAction(() => client.putProvider(id, body)),
    startRun: (body) => runAction(() => client.startRun(body)),
    stopRun: (runId) => runAction(() => client.stopRun(runId)),
    streamLogs: (runId, onLine, signal) =>
      client.streamLogs(runId, onLine, signal),
  };
}
