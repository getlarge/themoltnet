/** Team access extends the Run Center's existing control surfaces and native actions. */
import {
  Badge,
  Button,
  ConfirmDialog,
  ControlSurface,
  InlineNotice,
  Input,
  Select,
  Stack,
  Text,
} from '@themoltnet/design-system';
import { useEffect, useRef, useState } from 'react';

import { credentialLabel, expiryLabel } from './credential-health.js';
import type {
  AgentServerCatalogue,
  AgentServerCatalogueTeam,
  RunCenterActions,
  RunCenterData,
} from './types.js';

export function TeamsView({
  data,
  actions,
  now,
}: {
  data: RunCenterData;
  actions: RunCenterActions;
  now: number;
}) {
  const [identity, setIdentity] = useState(
    data.status?.selectedIdentity ??
      data.status?.agents[0]?.agentName ??
      data.status?.identities[0]?.alias ??
      '',
  );
  const [catalogue, setCatalogue] = useState<AgentServerCatalogue | null>(null);
  const [mode, setMode] = useState<'enroll' | 'replace'>('enroll');
  const [team, setTeam] = useState<AgentServerCatalogueTeam | null>(null);
  const [destinationTeamId, setDestinationTeamId] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [feedback, setFeedback] = useState<{
    title: string;
    message: string;
    error: boolean;
  } | null>(null);
  const inFlight = useRef(false);
  const [refreshVersion, setRefreshVersion] = useState(0);
  useEffect(() => {
    let current = true;
    setCatalogue(null);
    if (!identity) return;
    setLoading(true);
    void actions
      .catalogue(identity)
      .then(
        (value) => {
          if (current) {
            setCatalogue(value);
            setFeedback((previous) =>
              previous?.title === 'Team access could not be refreshed'
                ? null
                : previous,
            );
          }
        },
        () => {
          if (current)
            setFeedback({
              title: 'Team access could not be refreshed',
              message:
                'Check that the local server is running, then try again.',
              error: true,
            });
        },
      )
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [actions, identity, refreshVersion, data.server.state]);
  useEffect(() => {
    if (!identity)
      setIdentity(
        data.status?.selectedIdentity ??
          data.status?.agents[0]?.agentName ??
          data.status?.identities[0]?.alias ??
          '',
      );
  }, [data.status, identity]);

  const submit = async () => {
    if (inFlight.current || (mode !== 'replace' && !destinationTeamId.trim()))
      return;
    inFlight.current = true;
    const teamId = mode === 'replace' ? team!.teamId : destinationTeamId.trim();
    setConfirm(false);
    setBusy(true);
    setFeedback(null);
    try {
      {
        if (!actions.enrollTeam) throw new Error('Enrollment unavailable');
        const result = await actions.enrollTeam(identity, {
          teamId,
          idempotencyKey: crypto.randomUUID(),
          ...(mode === 'replace' && team
            ? { mode: 'replace' }
            : { mode: 'enroll' }),
        });
        if (result.state === 'recovery_required') {
          setFeedback({
            title: result.secretCaptured
              ? 'Credential saved for recovery'
              : 'Enrollment needs recovery',
            message: `${result.message}${result.issuedKeyId ? ` Issued key: ${result.issuedKeyId}.` : ''}${result.recoveryId ? ` Recovery record: ${result.recoveryId}.` : ''}`,
            error: true,
          });
          return;
        }
        setCatalogue(await actions.catalogue(identity));
      }
      await actions.refresh?.();
      setFeedback({
        title:
          mode === 'replace'
            ? 'Team credential renewed'
            : 'Team enrollment complete',
        message:
          'New runs will use the stored credential. Existing runs keep their current credential until restarted.',
        error: false,
      });
      setMode('enroll');
      setTeam(null);
    } catch {
      setFeedback({
        title: 'Enrollment could not be confirmed',
        message:
          'Refresh team access before retrying. Check the selected team; if issuance completed, inspect local recovery status before using a fresh approval.',
        error: true,
      });
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };
  return (
    <Stack gap={6}>
      <Stack gap={2}>
        <Stack
          direction="row"
          align="center"
          justify="space-between"
          wrap
          gap={3}
        >
          <Text as="h1" variant="h4">
            Identity and teams
          </Text>
          <Button
            variant="secondary"
            size="sm"
            disabled={busy || loading || !identity}
            onClick={() => setRefreshVersion((value) => value + 1)}
          >
            Refresh team access
          </Button>
        </Stack>
        <Text color="secondary">
          Approve team access in Console. The credential is saved automatically
          on this computer.
        </Text>
      </Stack>
      <Button
        variant="secondary"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setFeedback(null);
          try {
            if (!actions.signInOperator)
              throw new Error('Native sign-in unavailable');
            await actions.signInOperator();
            setFeedback({
              title: 'Local operator signed in',
              message: 'You can now connect Console to local agents.',
              error: false,
            });
          } catch {
            setFeedback({
              title: 'Sign-in did not complete',
              message: 'Try again and approve in Console.',
              error: true,
            });
          } finally {
            setBusy(false);
          }
        }}
      >
        Sign in for local control
      </Button>
      <Select
        label="Identity"
        value={identity}
        disabled={busy}
        onChange={(event) => {
          setIdentity(event.target.value);
          setTeam(null);
          setMode('enroll');
          setDestinationTeamId('');
        }}
      >
        <option value="">Select an identity…</option>
        {[
          ...new Set([
            ...(data.status?.agents.map((agent) => agent.agentName) ?? []),
            ...(data.status?.identities.map((entry) => entry.alias) ?? []),
          ]),
        ].map((alias) => (
          <option key={alias} value={alias}>
            {alias}
          </option>
        ))}
      </Select>
      {loading ? (
        <div role="status">
          <Text>Checking team access…</Text>
        </div>
      ) : null}
      {catalogue?.teams.map((entry) => (
        <ControlSurface key={entry.teamId}>
          <Stack gap={3}>
            <Stack
              direction="row"
              justify="space-between"
              align="center"
              wrap
              gap={3}
            >
              <Text weight="semibold">{entry.teamName}</Text>
              <Badge
                variant={
                  !entry.available
                    ? 'error'
                    : credentialLabel(entry, now) === 'Healthy'
                      ? 'success'
                      : 'warning'
                }
              >
                {credentialLabel(entry, now)}
              </Badge>
            </Stack>
            <Text variant="caption" color="secondary">
              {expiryLabel(entry.credential?.expiresAt)}
            </Text>
            {entry.credential ? (
              <Text variant="caption" color="muted">
                Last verified{' '}
                {new Date(entry.credential.verifiedAt).toLocaleString()}
              </Text>
            ) : null}
            {entry.blockers.map((blocker) => (
              <InlineNotice
                key={blocker.code}
                tone="warning"
                title={blocker.message}
              >
                {blocker.remedy}
              </InlineNotice>
            ))}
            <Stack direction="row" gap={2} wrap>
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() => {
                  setTeam(entry);
                  setMode('replace');
                  setDestinationTeamId('');
                }}
              >
                Renew
              </Button>
            </Stack>
          </Stack>
        </ControlSurface>
      ))}
      {catalogue && !catalogue.teams.length ? (
        <InlineNotice tone="info" title="No indexed team credentials">
          Enroll below, or preview indexing an existing team-bound key with{' '}
          <code>moltnet --identity {identity} config migrate --dry-run</code>.
          Apply the reviewed migration by removing <code>--dry-run</code>, then
          refresh team access. The migration verifies the key’s team binding and
          retains the original fallback credential.
        </InlineNotice>
      ) : null}
      <ControlSurface>
        <Stack gap={4}>
          <Stack direction="row" gap={2} wrap>
            <Button
              variant="secondary"
              disabled={busy || !identity}
              onClick={() => {
                setMode('enroll');
                setTeam(null);
              }}
            >
              Enroll into a team
            </Button>
          </Stack>
          <Text as="h2" variant="h4">
            {mode === 'replace'
              ? `Renew ${team?.teamName ?? 'team access'}`
              : 'Enroll into a team'}
          </Text>
          {mode === 'enroll' ? (
            <Input
              label="Team ID"
              value={destinationTeamId}
              disabled={busy}
              onChange={(event) => setDestinationTeamId(event.target.value)}
            />
          ) : null}
          <Text variant="caption" color="secondary">
            Console will show the selected identity, team and permissions before
            you approve.
          </Text>
          <Stack direction="row" gap={2} wrap>
            <Button
              disabled={
                busy ||
                (mode === 'enroll' && !destinationTeamId.trim()) ||
                !identity
              }
              onClick={() =>
                mode === 'replace' ? setConfirm(true) : void submit()
              }
            >
              {busy
                ? 'Waiting for approval…'
                : mode === 'replace'
                  ? 'Replace team credential'
                  : 'Approve in Console'}
            </Button>
          </Stack>
        </Stack>
      </ControlSurface>
      {feedback ? (
        <InlineNotice
          tone={feedback.error ? 'error' : 'success'}
          title={feedback.title}
        >
          {feedback.message}
        </InlineNotice>
      ) : null}
      <ConfirmDialog
        open={confirm}
        title={`Replace the credential for ${team?.teamName ?? 'this team'}?`}
        message="Future runs will use the replacement. Existing runs keep their predecessor credential until stopped or expired; restart them when ready."
        confirmLabel="Replace credential"
        onCancel={() => setConfirm(false)}
        onConfirm={() => void submit()}
      />
    </Stack>
  );
}
