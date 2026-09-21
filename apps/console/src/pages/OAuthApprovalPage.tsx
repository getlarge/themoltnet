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
  const params = new URLSearchParams(window.location.search);
  const login = params.get('login_challenge');
  const consent = params.get('consent_challenge');
  useEffect(() => {
    let active = true;
    if (consent)
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
    else if (!login) setError('No authorization request was supplied.');
    return () => {
      active = false;
    };
  }, [login, consent]);
  async function continueLogin() {
    if (!login || busy) return;
    setBusy(true);
    setError(null);
    try {
      const { data } = await acceptOperatorLogin({
        client: getApiClient(),
        body: { challenge: login },
      });
      if (!data) throw new Error('Login unavailable');
      window.location.replace(data.redirect_to);
    } catch {
      setError(
        'Sign-in could not continue. Start a fresh request from Desktop or the authorized controller.',
      );
      setBusy(false);
    }
  }
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
        {login
          ? 'Continue with your Console account?'
          : approval?.operation === 'operator-sign-in'
            ? 'Set the local operator?'
            : approval?.operation === 'local-control'
              ? 'Allow Agent Server control?'
              : 'Approve team access'}
      </Text>
      {login ? (
        <>
          <Text>
            Continue to review the requested access before approving it.
          </Text>
          <Button disabled={busy} onClick={() => void continueLogin()}>
            Continue
          </Button>
        </>
      ) : approval ? (
        <>
          <Text>
            {approval.operation === 'renew'
              ? 'Renew a team credential.'
              : approval.operation === 'enroll'
                ? 'Enroll an agent into a team and issue its credential.'
                : approval.operation === 'operator-sign-in'
                  ? 'Use your signed-in account as the local operator on this computer.'
                  : 'Allow the requesting controller to manage this Agent Server.'}
          </Text>
          <dl>
            {(
              [
                ['Agent', approval.agent],
                ['Team', approval.team],
              ] as const
            ).map(([label, value]) =>
              value ? (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd
                    style={{
                      marginInlineStart: 0,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      maxWidth: '100%',
                    }}
                  >
                    “
                    <bdi>
                      {value
                        .replace(
                          /[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/gu,
                          '',
                        )
                        .slice(0, 120)}
                    </bdi>
                    ”
                  </dd>
                </div>
              ) : null,
            )}
          </dl>
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
