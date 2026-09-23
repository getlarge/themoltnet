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
  const [creating, setCreating] = useState(false);
  const [newAgentName, setNewAgentName] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [createError, setCreateError] = useState(false);
  const [createdIdentity, setCreatedIdentity] = useState<string | null>(null);
  const [catalogue, setCatalogue] = useState<AgentServerCatalogue | null>(null);
  const [mode, setMode] = useState<'enroll' | 'replace'>('enroll');
  const [team, setTeam] = useState<AgentServerCatalogueTeam | null>(null);
  const [destinationTeamId, setDestinationTeamId] = useState('');
  const [operatorTeams, setOperatorTeams] = useState<
    { id: string; name: string }[]
  >([]);
  const [operatorTeamsLoading, setOperatorTeamsLoading] = useState(false);
  const [operatorTeamsError, setOperatorTeamsError] = useState(false);
  const [manualTeamId, setManualTeamId] = useState(false);
  const [busy, setBusy] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [loading, setLoading] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [feedback, setFeedback] = useState<{
    title: string;
    message: string;
    error: boolean;
  } | null>(null);
  const inFlight = useRef(false);
  const cancellationRequested = useRef(false);
  const [refreshVersion, setRefreshVersion] = useState(0);
  useEffect(() => {
    if (!feedback || feedback.error) return;
    const timer = window.setTimeout(() => setFeedback(null), 8000);
    return () => window.clearTimeout(timer);
  }, [feedback]);
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
  useEffect(() => {
    let current = true;
    if (!data.operatorConfigured || !actions.operatorTeams) {
      setOperatorTeams([]);
      return;
    }
    setOperatorTeamsLoading(true);
    setOperatorTeamsError(false);
    void actions
      .operatorTeams()
      .then(
        ({ items }) => {
          if (current) setOperatorTeams(items);
        },
        () => {
          if (current) setOperatorTeamsError(true);
        },
      )
      .finally(() => {
        if (current) setOperatorTeamsLoading(false);
      });
    return () => {
      current = false;
    };
  }, [actions, data.operatorConfigured, refreshVersion]);

  const submit = async () => {
    if (inFlight.current || (mode !== 'replace' && !destinationTeamId.trim()))
      return;
    inFlight.current = true;
    cancellationRequested.current = false;
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
        title: cancellationRequested.current
          ? 'Approval cancelled'
          : 'Enrollment could not be confirmed',
        message:
          'Refresh team access before retrying. If issuance completed, inspect local recovery status before using a fresh approval.',
        error: !cancellationRequested.current,
      });
    } finally {
      inFlight.current = false;
      setBusy(false);
      setCancelling(false);
    }
  };
  const createIdentity = async () => {
    if (busy || !newAgentName.trim() || !inviteCode.trim()) return;
    setBusy(true);
    setCreateError(false);
    setFeedback(null);
    try {
      if (!actions.createManagedAgent)
        throw new Error('Identity creation unavailable');
      const agent = await actions.createManagedAgent(
        newAgentName.trim(),
        inviteCode.trim(),
      );
      setNewAgentName('');
      setCreating(false);
      setCreatedIdentity(agent.agentName);
      setIdentity(agent.agentName);
      await actions.refresh?.().catch(() => undefined);
      setFeedback({
        title: 'Agent identity created',
        message: `${agent.agentName} is enrolled in its team and ready for provider setup.`,
        error: false,
      });
    } catch {
      setCreateError(true);
    } finally {
      setInviteCode('');
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
          {identity ? (
            <Button
              variant="secondary"
              size="sm"
              disabled={busy || loading || !identity}
              onClick={() => setRefreshVersion((value) => value + 1)}
            >
              Refresh team access
            </Button>
          ) : null}
        </Stack>
        <Text color="secondary">
          {identity
            ? 'Approve team access in the browser. The credential is saved automatically on this computer.'
            : 'Create an agent identity to run work for your team.'}
        </Text>
      </Stack>
      {data.operatorConfigured ? (
        <Badge variant="success">Signed in</Badge>
      ) : null}
      {identity ? (
        <Stack direction="row" gap={3} align="center" wrap>
          <Button
            variant="secondary"
            disabled={busy}
            onClick={async () => {
              cancellationRequested.current = false;
              setBusy(true);
              setFeedback(null);
              try {
                if (!actions.signInOperator)
                  throw new Error('Native sign-in unavailable');
                await actions.signInOperator();
                if (actions.operatorTeams) {
                  try {
                    const { items } = await actions.operatorTeams();
                    setOperatorTeams(items);
                    setOperatorTeamsError(false);
                  } catch {
                    setOperatorTeamsError(true);
                  }
                }
                await actions.refresh?.();
                if (data.operatorConfigured)
                  setRefreshVersion((value) => value + 1);
                setFeedback({
                  title: 'Local operator signed in',
                  message:
                    'You can now manage team credentials on this computer.',
                  error: false,
                });
              } catch {
                setFeedback({
                  title: cancellationRequested.current
                    ? 'Approval cancelled'
                    : 'Sign-in did not complete',
                  message: 'Try again and approve in the browser.',
                  error: !cancellationRequested.current,
                });
              } finally {
                setBusy(false);
                setCancelling(false);
              }
            }}
          >
            {data.operatorConfigured
              ? 'Refresh operator teams'
              : 'Sign in as operator'}
          </Button>
          {data.operatorConfigured ? (
            <Text variant="caption" color="secondary">
              Team choices are updated when you approve again in the browser.
            </Text>
          ) : null}
        </Stack>
      ) : null}
      {busy && actions.cancelOperatorApproval ? (
        <Stack direction="row" gap={3} align="center" wrap>
          <Text variant="caption" color="secondary">
            If you closed the approval tab, cancel here to try again.
          </Text>
          <Button
            variant="secondary"
            disabled={cancelling}
            onClick={async () => {
              setCancelling(true);
              cancellationRequested.current = true;
              try {
                await actions.cancelOperatorApproval?.();
              } catch {
                cancellationRequested.current = false;
                setCancelling(false);
                setFeedback({
                  title: 'Cancellation could not be confirmed',
                  message: 'Check the Server view, then try again.',
                  error: true,
                });
              }
            }}
          >
            {cancelling ? 'Cancelling…' : 'Cancel approval'}
          </Button>
        </Stack>
      ) : null}
      <Stack
        direction="row"
        align="center"
        justify="space-between"
        wrap
        gap={2}
      >
        <Text weight="semibold">Agent identities</Text>
        {identity ||
        data.status?.agents.length ||
        data.status?.identities.length ? (
          <Button
            variant="secondary"
            size="sm"
            disabled={busy}
            onClick={() => {
              setCreating((value) => !value);
              setCreateError(false);
            }}
          >
            {creating ? 'Cancel' : 'Create identity'}
          </Button>
        ) : null}
      </Stack>
      {creating ||
      (data.status &&
        !identity &&
        !data.status.identities.length &&
        !data.status.agents.length) ? (
        <ControlSurface>
          <Stack gap={3}>
            <Text as="h2" variant="h4">
              Create an agent identity
            </Text>
            <Text variant="caption" color="secondary">
              Create an executor invite code on the team page in Console. The
              code enrolls this new agent in that team.
            </Text>
            <Input
              label="Agent name"
              value={newAgentName}
              disabled={busy}
              onChange={(event) => setNewAgentName(event.target.value)}
            />
            <Input
              label="Team invite code"
              type="password"
              value={inviteCode}
              disabled={busy}
              onChange={(event) => setInviteCode(event.target.value)}
            />
            {createError ? (
              <InlineNotice
                tone="error"
                title="Identity creation could not be confirmed"
              >
                Check the agent name and invite code. If registration began,
                check the Server view for recovery before trying this name
                again.
              </InlineNotice>
            ) : null}
            <Button
              disabled={busy || !newAgentName.trim() || !inviteCode.trim()}
              onClick={() => void createIdentity()}
            >
              {busy ? 'Creating identity…' : 'Create and enroll'}
            </Button>
          </Stack>
        </ControlSurface>
      ) : null}
      {identity ||
      data.status?.agents.length ||
      data.status?.identities.length ? (
        <Select
          label="Identity"
          value={identity}
          disabled={busy}
          onChange={(event) => {
            setIdentity(event.target.value);
            setTeam(null);
            setMode('enroll');
            setDestinationTeamId('');
            setManualTeamId(false);
          }}
        >
          <option value="">Select an identity…</option>
          {[
            ...new Set([
              ...(data.status?.agents.map((agent) => agent.agentName) ?? []),
              ...(data.status?.identities.map((entry) => entry.alias) ?? []),
              ...(createdIdentity ? [createdIdentity] : []),
            ]),
          ].map((alias) => (
            <option key={alias} value={alias}>
              {alias}
            </option>
          ))}
        </Select>
      ) : null}
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
      {identity ? (
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
              <Stack gap={3}>
                {operatorTeamsLoading ? (
                  <Text variant="caption">Loading operator teams…</Text>
                ) : operatorTeams.length ? (
                  <Select
                    label="Team"
                    value={manualTeamId ? 'manual' : destinationTeamId}
                    disabled={busy}
                    onChange={(event) => {
                      const value = event.target.value;
                      setManualTeamId(value === 'manual');
                      setDestinationTeamId(value === 'manual' ? '' : value);
                    }}
                  >
                    <option value="">Select a team…</option>
                    {operatorTeams.map((entry) => (
                      <option key={entry.id} value={entry.id}>
                        {entry.name}
                      </option>
                    ))}
                    <option value="manual">Enter a team ID…</option>
                  </Select>
                ) : null}
                {operatorTeams.length && !operatorTeamsLoading ? (
                  <Text variant="caption" color="muted">
                    Active project teams you can enroll agents into, from your
                    last operator approval.
                  </Text>
                ) : null}
                {operatorTeamsError ? (
                  <InlineNotice tone="warning" title="Team choices unavailable">
                    Refresh operator teams or enter a team ID.
                  </InlineNotice>
                ) : null}
                {(!operatorTeams.length || manualTeamId) &&
                !operatorTeamsLoading ? (
                  <Input
                    label="Team ID"
                    value={destinationTeamId}
                    disabled={busy}
                    onChange={(event) =>
                      setDestinationTeamId(event.target.value)
                    }
                  />
                ) : null}
              </Stack>
            ) : null}
            <Text variant="caption" color="secondary">
              Console will show the selected identity, team and permissions
              before you approve.
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
                    : 'Approve in browser'}
              </Button>
            </Stack>
          </Stack>
        </ControlSurface>
      ) : null}
      {feedback?.error ? (
        <InlineNotice
          tone={feedback.error ? 'error' : 'success'}
          title={feedback.title}
        >
          {feedback.message}
        </InlineNotice>
      ) : null}
      {feedback && !feedback.error ? (
        <aside
          className="run-center__toast"
          role="status"
          aria-label="Approval completed"
          aria-live="polite"
          aria-atomic="true"
        >
          <Stack gap={2}>
            <Text weight="semibold">{feedback.title}</Text>
            <Text variant="caption" color="secondary">
              {feedback.message}
            </Text>
          </Stack>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setFeedback(null)}
            aria-label="Dismiss notification"
          >
            Dismiss
          </Button>
        </aside>
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
