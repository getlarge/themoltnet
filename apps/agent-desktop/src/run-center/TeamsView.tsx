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
import { useEffect, useId, useRef, useState } from 'react';

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
  const [mode, setMode] = useState<'enroll' | 'new' | 'replace'>('enroll');
  const [team, setTeam] = useState<AgentServerCatalogueTeam | null>(null);
  const [name, setName] = useState('');
  const [invitation, setInvitation] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [feedback, setFeedback] = useState<{
    title: string;
    message: string;
    error: boolean;
  } | null>(null);
  const inFlight = useRef(false);
  const invitationId = useId();
  useEffect(() => {
    if (mode === 'replace' && team)
      document.getElementById(invitationId)?.focus();
  }, [mode, team, invitationId]);
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
          if (current) setCatalogue(value);
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
    if (inFlight.current || !invitation.trim()) return;
    inFlight.current = true;
    const code = invitation.trim();
    setInvitation('');
    setConfirm(false);
    setBusy(true);
    setFeedback(null);
    try {
      if (mode === 'new') {
        if (!actions.createIdentity) throw new Error('Creation unavailable');
        await actions.createIdentity(name.trim(), code);
        setIdentity(name.trim());
      } else {
        if (!actions.enrollTeam) throw new Error('Enrollment unavailable');
        const result = await actions.enrollTeam(identity, {
          code,
          idempotencyKey: crypto.randomUUID(),
          ...(mode === 'replace' && team
            ? { mode: 'replace', teamId: team.teamId }
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
          'Refresh team access before retrying. Check the invitation and selected team; if issuance completed, inspect local recovery status before using a fresh invitation.',
        error: true,
      });
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };
  const openConsole = async (teamId?: string) => {
    try {
      await actions.openTeamInvites?.(teamId);
    } catch {
      setFeedback({
        title: 'Console could not open',
        message: 'Open Console and select the team’s Invites tab.',
        error: true,
      });
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
          Enroll this identity with an invitation from your team’s Console.
        </Text>
      </Stack>
      <Select
        label="Identity"
        value={identity}
        disabled={busy}
        onChange={(event) => {
          setIdentity(event.target.value);
          setTeam(null);
          setMode('enroll');
          setInvitation('');
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
      {loading ? <Text role="status">Checking team access…</Text> : null}
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
                  setInvitation('');
                }}
              >
                Renew
              </Button>
              <Button
                variant="ghost"
                onClick={() => void openConsole(entry.teamId)}
              >
                Renew in Console
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
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => {
                setMode('new');
                setTeam(null);
                setInvitation('');
              }}
            >
              Create a new identity
            </Button>
          </Stack>
          <Text as="h2" variant="h4">
            {mode === 'new'
              ? 'Create an identity'
              : mode === 'replace'
                ? `Renew ${team?.teamName ?? 'team access'}`
                : 'Enroll into a team'}
          </Text>
          {mode === 'new' ? (
            <Input
              label="Identity name"
              value={name}
              disabled={busy}
              onChange={(event) => setName(event.target.value)}
            />
          ) : null}
          <Input
            id={invitationId}
            label="Single-use invitation"
            type="password"
            autoComplete="off"
            value={invitation}
            disabled={busy}
            onChange={(event) => setInvitation(event.target.value)}
          />
          <Text variant="caption" color="secondary">
            Create an invitation in Console, then paste it here. The invitation
            is cleared when submitted.
          </Text>
          <Stack direction="row" gap={2} wrap>
            <Button
              disabled={
                busy ||
                !invitation.trim() ||
                (mode === 'new' ? !name.trim() : !identity)
              }
              onClick={() =>
                mode === 'replace' ? setConfirm(true) : void submit()
              }
            >
              {busy
                ? 'Enrolling…'
                : mode === 'replace'
                  ? 'Replace team credential'
                  : mode === 'new'
                    ? 'Create and enroll'
                    : 'Enroll'}
            </Button>
            <Button
              variant="ghost"
              onClick={() => void openConsole(team?.teamId)}
            >
              Get an invitation in Console
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
