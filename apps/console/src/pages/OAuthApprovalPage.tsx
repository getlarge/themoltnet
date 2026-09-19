import {
  acceptOperatorConsent,
  acceptOperatorLogin,
  getOperatorConsent,
} from '@moltnet/api-client';
import { Button, InlineNotice, Stack, Text } from '@themoltnet/design-system';
import { useEffect, useRef, useState } from 'react';

import { getApiClient } from '../api.js';

type Approval = {
  operation: string;
  agent?: string;
  team?: string;
  permissions: string[];
  instance: string;
};
export function OAuthApprovalPage() {
  const [approval, setApproval] = useState<Approval | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const loginExchange = useRef<{
    challenge: string;
    promise: Promise<{ redirect_to: string }>;
  } | null>(null);
  const params = new URLSearchParams(window.location.search);
  const login = params.get('login_challenge');
  const consent = params.get('consent_challenge');
  useEffect(() => {
    let active = true;
    if (login) {
      if (loginExchange.current?.challenge !== login)
        loginExchange.current = {
          challenge: login,
          promise: acceptOperatorLogin({
            client: getApiClient(),
            body: { challenge: login },
          }).then(({ data }) => {
            if (!data) throw new Error('Login rejected');
            return data;
          }),
        };
      void loginExchange.current.promise
        .then((result) => {
          if (active) window.location.replace(result.redirect_to);
        })
        .catch(() => {
          if (active)
            setError(
              'Sign-in could not continue. Start again from Desktop or local control.',
            );
        });
    } else if (consent)
      void getOperatorConsent({
        client: getApiClient(),
        query: { challenge: consent },
      })
        .then(({ data }) => {
          if (!data) throw new Error('Consent unavailable');
          if (active) setApproval(data);
        })
        .catch(() => {
          if (active)
            setError(
              'You cannot approve this request. Check the selected team and permissions.',
            );
        });
    else setError('No authorization request was supplied.');
    return () => {
      active = false;
    };
  }, [login, consent]);
  async function decide(approve: boolean) {
    setBusy(true);
    setError(null);
    try {
      if (!consent) throw new Error('Missing consent');
      const { data } = await acceptOperatorConsent({
        client: getApiClient(),
        body: { challenge: consent, approve },
      });
      if (!data) throw new Error('Consent rejected');
      window.location.replace(data.redirect_to);
    } catch {
      setError('Approval could not complete. Start a fresh request.');
      setBusy(false);
    }
  }
  return (
    <Stack gap={4}>
      <Text as="h1" variant="h4">
        {approval?.operation === 'operator-sign-in'
          ? 'Set the local operator?'
          : approval?.operation === 'local-control'
            ? 'Allow local agent control?'
            : 'Approve team access'}
      </Text>
      {approval ? (
        <>
          <Text>
            {approval.operation === 'renew'
              ? 'Renew the credential for'
              : approval.operation === 'enroll'
                ? 'Enroll'
                : approval.operation === 'operator-sign-in'
                  ? 'Use your signed-in account as the local operator on'
                  : 'Allow this Console to manage local agents on'}{' '}
            {approval.agent ?? 'this computer'}
            {approval.team ? ` in ${approval.team}` : ''}.
          </Text>
          <Text as="h2" weight="semibold">
            Requested permissions
          </Text>
          <ul>
            {approval.permissions.map((permission) => (
              <li key={permission}>{permission}</li>
            ))}
          </ul>
          <Text color="secondary">
            {approval.operation === 'operator-sign-in'
              ? 'Approval expires in five minutes. Your operator identity stays on this computer until you remove it through native administration.'
              : approval.operation === 'local-control'
                ? 'Access lasts fifteen minutes and ends when Agent Server restarts.'
                : 'Approval expires in five minutes and authorizes this request only.'}
          </Text>
          <Stack direction="row" gap={3}>
            <Button disabled={busy} onClick={() => void decide(true)}>
              Approve
            </Button>
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => void decide(false)}
            >
              Decline
            </Button>
          </Stack>
        </>
      ) : !error ? (
        <div role="status">
          <Text>Loading approval…</Text>
        </div>
      ) : null}
      {error ? (
        <InlineNotice tone="error" title="Approval unavailable">
          {error}
        </InlineNotice>
      ) : null}
    </Stack>
  );
}
export function LocalOAuthCallback() {
  const delivered = useRef(false);
  useEffect(() => {
    if (delivered.current) return;
    delivered.current = true;
    const params = new URLSearchParams(window.location.search);
    (window.opener as Window | null)?.postMessage(
      {
        type: 'moltnet-oauth-callback',
        code: params.get('code'),
        state: params.get('state'),
        error: params.get('error'),
      },
      window.location.origin,
    );
    window.history.replaceState(null, '', window.location.pathname);
  }, []);
  return <p>Approval received. You can close this window.</p>;
}
