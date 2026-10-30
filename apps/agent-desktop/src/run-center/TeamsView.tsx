/** Team access extends the Run Center's existing control surfaces and native actions. */
import {
  AGENT_CREDENTIAL_SCOPES,
  CREDENTIAL_SCOPE_DESCRIPTIONS,
  DAEMON_MINIMUM_SCOPES,
  OPERATOR_OAUTH,
  TEAM_AGENT_KEY_SCOPES,
} from '@moltnet/models';
import {
  Badge,
  Button,
  ConfirmDialog,
  ControlSurface,
  Disclosure,
  InlineNotice,
  Input,
  Select,
  Stack,
  Text,
} from '@themoltnet/design-system';
import { useEffect, useRef, useState } from 'react';

import { credentialLabel, expiryLabel } from './credential-health.js';
import type {
  AgentServerCatalogueTeam,
  RunCenterActions,
  RunCenterData,
} from './types.js';
import { useCatalogue } from './useCatalogue.js';

/** Preserve a verified set; an unavailable credential needs the safe default. */
function scopesForRenewal(entry: AgentServerCatalogueTeam): string[] {
  const verified = entry.credential?.scopes;
  const selected = verified?.length ? verified : AGENT_CREDENTIAL_SCOPES;
  return [...new Set([...DAEMON_MINIMUM_SCOPES, ...selected])].filter((scope) =>
    (TEAM_AGENT_KEY_SCOPES as readonly string[]).includes(scope),
  );
}

function recoveryRouteUnavailable(error: unknown): boolean {
  if (typeof error === 'object' && error !== null) {
    const value = error as { status?: unknown; statusCode?: unknown };
    if (value.status === 404 || value.statusCode === 404) return true;
  }
  return /\b404\b/.test(String(error));
}

/** The native bridge preserves the server's allowlisted approval messages. */
function approvalFailure(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (message.startsWith('Team approval denied.'))
    return {
      title: 'Team access required',
      message:
        'Your account cannot renew this team’s credential. Ask a team owner for credential-management access. Refreshing alone does not grant access.',
      error: true,
    };
  if (message.startsWith('Approval expired.'))
    return {
      title: 'Approval timed out',
      message:
        'The five-minute approval window ended. No credential was issued. Start a new approval when you are ready.',
      error: true,
    };
  if (message.startsWith('Approval denied.'))
    return {
      title: 'Approval declined',
      message:
        'No credential was issued. You can start a new approval when ready.',
      error: true,
    };
  return null;
}

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
  // Drives the operator-teams read below; the catalogue refreshes via the cache.
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [mode, setMode] = useState<'enroll' | 'replace'>('enroll');
  const [reviewOpen, setReviewOpen] = useState(false);
  const [team, setTeam] = useState<AgentServerCatalogueTeam | null>(null);
  const [scopes, setScopes] = useState<string[]>([...AGENT_CREDENTIAL_SCOPES]);
  const [recoveries, setRecoveries] = useState<
    Awaited<
      ReturnType<NonNullable<RunCenterActions['listEnrollmentRecoveries']>>
    >['items']
  >([]);
  const [recoveriesError, setRecoveriesError] = useState<
    'unavailable' | 'unsupported' | null
  >(null);
  const [recoveryVersion, setRecoveryVersion] = useState(0);
  const [destinationTeamId, setDestinationTeamId] = useState('');
  const [operatorTeams, setOperatorTeams] = useState<
    { id: string; name: string }[]
  >([]);
  const [operatorTeamsLoading, setOperatorTeamsLoading] = useState(false);
  const [operatorTeamsLoaded, setOperatorTeamsLoaded] = useState(false);
  const [operatorTeamsError, setOperatorTeamsError] = useState(false);
  const [manualTeamId, setManualTeamId] = useState(false);
  const [busy, setBusy] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [removeTarget, setRemoveTarget] =
    useState<AgentServerCatalogueTeam | null>(null);
  const [discardTarget, setDiscardTarget] = useState<{
    identity: string;
    recoveryId: string;
    secretCaptured: boolean;
  } | null>(null);
  const [feedback, setFeedback] = useState<{
    title: string;
    message: string;
    error: boolean;
  } | null>(null);
  const renewalForm = useRef<HTMLElement>(null);
  const teamAccess = useRef<HTMLElement>(null);
  const wasReviewOpen = useRef(false);
  const errorNotice = useRef<HTMLDivElement>(null);
  const [pendingApproval, setPendingApproval] = useState<{
    kind: 'sign-in' | 'enrollment';
    startedAt: number;
  } | null>(null);
  const [approvalSecondsLeft, setApprovalSecondsLeft] = useState(0);
  useEffect(() => {
    if (!pendingApproval) return;
    const update = () =>
      setApprovalSecondsLeft(
        Math.max(
          0,
          OPERATOR_OAUTH.nativeLifetimeSeconds -
            Math.floor((Date.now() - pendingApproval.startedAt) / 1000),
        ),
      );
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [pendingApproval]);
  useEffect(() => {
    if (!reviewOpen) {
      if (wasReviewOpen.current) teamAccess.current?.focus();
      wasReviewOpen.current = false;
      return;
    }
    wasReviewOpen.current = true;
    renewalForm.current?.focus();
    renewalForm.current?.scrollIntoView?.({ block: 'start' });
  }, [reviewOpen, mode, team]);
  useEffect(() => {
    if (!feedback?.error) return;
    errorNotice.current?.focus();
    errorNotice.current?.scrollIntoView?.({ block: 'nearest' });
  }, [feedback]);
  const inFlight = useRef(false);
  const cancellationRequested = useRef(false);
  useEffect(() => {
    if (!feedback || feedback.error) return;
    const timer = window.setTimeout(() => setFeedback(null), 8000);
    return () => window.clearTimeout(timer);
  }, [feedback]);
  const {
    catalogue,
    loading,
    error: catalogueError,
    retry: retryCatalogue,
  } = useCatalogue(identity, { read: actions.catalogue });
  useEffect(() => {
    // Team access shares the feedback banner with enrollment results, so the
    // catalogue's own error is mirrored into it and cleared once it recovers.
    if (catalogueError) {
      setFeedback({
        title: 'Team access could not be refreshed',
        message: 'Check that the local server is running, then try again.',
        error: true,
      });
      return;
    }
    setFeedback((previous) =>
      previous?.title === 'Team access could not be refreshed'
        ? null
        : previous,
    );
  }, [catalogueError, catalogue]);
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
    if (!identity || !actions.listEnrollmentRecoveries) {
      setRecoveries([]);
      return;
    }
    let current = true;
    setRecoveries([]);
    setRecoveriesError(null);
    void actions.listEnrollmentRecoveries(identity).then(
      ({ items }) => {
        if (current) setRecoveries(items);
      },
      (error: unknown) => {
        if (current)
          setRecoveriesError(
            recoveryRouteUnavailable(error) ? 'unsupported' : 'unavailable',
          );
      },
    );
    return () => {
      current = false;
    };
  }, [actions, identity, recoveryVersion]);
  useEffect(() => {
    let current = true;
    if (!data.operatorConfigured || !actions.operatorTeams) {
      setOperatorTeams([]);
      setOperatorTeamsLoaded(false);
      return;
    }
    setOperatorTeamsLoading(true);
    setOperatorTeamsLoaded(false);
    setOperatorTeamsError(false);
    void actions
      .operatorTeams()
      .then(
        ({ items }) => {
          if (current) {
            setOperatorTeams(items);
            setOperatorTeamsLoaded(true);
          }
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
    setPendingApproval({ kind: 'enrollment', startedAt: Date.now() });
    try {
      if (!actions.enrollTeam) throw new Error('Enrollment unavailable');
      const result = await actions.enrollTeam(identity, {
        teamId,
        idempotencyKey: crypto.randomUUID(),
        scopes,
        ...(mode === 'replace' && team
          ? { mode: 'replace' }
          : { mode: 'enroll' }),
      });
      if (result.state === 'retryable') {
        setFeedback({
          title: 'Approval request was throttled',
          message: result.message,
          error: true,
        });
        return;
      }
      if (result.state === 'recovery_required') {
        setRecoveryVersion((value) => value + 1);
        setFeedback({
          title: result.secretCaptured
            ? 'Credential saved for recovery'
            : 'Enrollment needs recovery',
          message: result.secretCaptured
            ? `${result.message} Go back to team access and open Credential recovery to restore it.`
            : `${result.message} No secret is available to restore. Refresh team access and inspect retry context before requesting new approval.`,
          error: true,
        });
        return;
      }
      retryCatalogue();
      setRecoveryVersion((value) => value + 1);
      await actions.refresh?.();
      setFeedback({
        title:
          mode === 'replace'
            ? 'Team credential renewed'
            : 'Team enrollment complete',
        message: `${Array.isArray(result.scopes) ? `Issued scopes: ${result.scopes.join(', ')}. ` : 'Refresh team access to inspect the issued scopes. '}New runs will use the stored credential. Existing runs keep their current credential until restarted.`,
        error: false,
      });
      setMode('enroll');
      setTeam(null);
      setReviewOpen(false);
    } catch (error) {
      setFeedback(
        (!cancellationRequested.current && approvalFailure(error)) || {
          title: cancellationRequested.current
            ? 'Approval cancelled'
            : 'Enrollment could not be confirmed',
          message:
            'Refresh team access before retrying. If issuance completed, inspect local recovery status before using a fresh approval.',
          error: !cancellationRequested.current,
        },
      );
    } finally {
      inFlight.current = false;
      setPendingApproval(null);
      setBusy(false);
      setCancelling(false);
    }
  };
  const setTeamVisibility = async (teamId: string, hidden: boolean) => {
    if (busy || !actions.setTeamVisibility) return;
    setBusy(true);
    try {
      await actions.setTeamVisibility(identity, teamId, hidden);
    } catch {
      setFeedback({
        title: 'Team setting could not be saved',
        message: 'Check the local server and try again.',
        error: true,
      });
      setBusy(false);
      setRemoveTarget(null);
      return;
    }
    try {
      retryCatalogue();
      await actions.refresh?.();
      setFeedback({
        title: hidden
          ? 'Team removed from Desktop'
          : 'Team restored to Desktop',
        message: hidden
          ? 'New runs cannot use this team here. Existing runs and the shared CLI credential are unchanged.'
          : 'This team is available for new runs again.',
        error: false,
      });
    } catch {
      setFeedback({
        title: 'Team setting saved; refresh failed',
        message:
          'The local change took effect. Refresh the server status to see the latest team access.',
        error: true,
      });
    } finally {
      setBusy(false);
      setRemoveTarget(null);
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
  const approvalStatus = (
    <Stack gap={3}>
      <div role="status">
        <Text weight="semibold">Waiting for browser approval</Text>
        <Text variant="caption" color="secondary">
          {approvalSecondsLeft > 0
            ? `Complete approval in your browser. Expires in ${Math.floor(approvalSecondsLeft / 60)}:${String(approvalSecondsLeft % 60).padStart(2, '0')}.`
            : 'Approval is ending. You can cancel if the browser did not return.'}
        </Text>
      </div>
      {actions.cancelOperatorApproval ? (
        <Button
          variant="secondary"
          disabled={cancelling}
          style={{ alignSelf: 'flex-start' }}
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
      ) : null}
    </Stack>
  );
  const teamLabel = (id: string, name?: string) =>
    operatorTeams.find((entry) => entry.id === id)?.name ??
    (name && name !== id ? name : `Team ${id.slice(0, 8)}`);
  const openEnrollment = () => {
    setMode('enroll');
    setTeam(null);
    setScopes([...AGENT_CREDENTIAL_SCOPES]);
    setDestinationTeamId('');
    setManualTeamId(false);
    setFeedback(null);
    setReviewOpen(true);
  };
  return (
    <Stack gap={6}>
      <Stack gap={2}>
        <Text as="h1" variant="h4">
          Identity and teams
        </Text>
        <Text color="secondary">
          Choose an agent and manage its access to your teams.
        </Text>
      </Stack>
      {!reviewOpen ? (
        <>
          {feedback?.error ? (
            <div ref={errorNotice} tabIndex={-1}>
              <InlineNotice
                tone={feedback.error ? 'error' : 'success'}
                title={feedback.title}
              >
                {feedback.message}
              </InlineNotice>
            </div>
          ) : null}

          <ControlSurface>
            <Stack gap={4}>
              <Stack direction="row" align="flex-end" gap={3} wrap>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <Select
                    label="Identity"
                    value={identity}
                    disabled={busy}
                    onChange={(event) => {
                      setIdentity(event.target.value);
                      setTeam(null);
                      setMode('enroll');
                      setScopes([...AGENT_CREDENTIAL_SCOPES]);
                      setDestinationTeamId('');
                      setManualTeamId(false);
                    }}
                  >
                    <option value="">Select an identity…</option>
                    {[
                      ...new Set([
                        ...(data.status?.agents.map(
                          (agent) => agent.agentName,
                        ) ?? []),
                        ...(data.status?.identities.map(
                          (entry) => entry.alias,
                        ) ?? []),
                        ...(createdIdentity ? [createdIdentity] : []),
                      ]),
                    ].map((alias) => (
                      <option key={alias} value={alias}>
                        {alias}
                      </option>
                    ))}
                  </Select>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  onClick={() => {
                    setCreating((value) => !value);
                    setCreateError(false);
                  }}
                >
                  {creating ? 'Cancel creation' : 'Create identity'}
                </Button>
              </Stack>
              <div className="teams-view__operator">
                <Stack
                  direction="row"
                  justify="space-between"
                  align="center"
                  gap={3}
                  wrap
                >
                  <Stack gap={1}>
                    <Text weight="semibold">Your approval account</Text>
                    <Stack direction="row" gap={2} align="center" wrap>
                      <Badge
                        variant={
                          data.operatorConfigured ? 'success' : 'default'
                        }
                      >
                        {data.operatorConfigured
                          ? 'Signed in'
                          : 'Not signed in'}
                      </Badge>
                      {data.operatorEmail ? (
                        <Text variant="caption" color="secondary">
                          {data.operatorEmail}
                        </Text>
                      ) : null}
                    </Stack>
                  </Stack>
                  <Button
                    variant="ghost"
                    disabled={busy}
                    onClick={async () => {
                      cancellationRequested.current = false;
                      setBusy(true);
                      setFeedback(null);
                      setPendingApproval({
                        kind: 'sign-in',
                        startedAt: Date.now(),
                      });
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
                            'Team choices are up to date. Managing credentials still requires permission from the team.',
                          error: false,
                        });
                      } catch (error) {
                        setFeedback(
                          (!cancellationRequested.current &&
                            approvalFailure(error)) || {
                            title: cancellationRequested.current
                              ? 'Approval cancelled'
                              : 'Sign-in did not complete',
                            message: 'Try again and approve in the browser.',
                            error: !cancellationRequested.current,
                          },
                        );
                      } finally {
                        setPendingApproval(null);
                        setBusy(false);
                        setCancelling(false);
                      }
                    }}
                  >
                    {data.operatorConfigured
                      ? 'Refresh operator teams'
                      : 'Sign in as operator'}
                  </Button>
                </Stack>
                <Text variant="caption" color="secondary">
                  This account approves access. The agent runs with its own
                  credentials.
                </Text>
              </div>
              {pendingApproval?.kind === 'sign-in' ? approvalStatus : null}
            </Stack>
          </ControlSurface>
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
                  Create an executor invite code on the team page in Console.
                  The code enrolls this new agent in that team.
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

          {identity ? (
            <section
              ref={teamAccess}
              tabIndex={-1}
              aria-labelledby="team-access-heading"
            >
              <Stack gap={3}>
                <Stack
                  direction="row"
                  justify="space-between"
                  align="center"
                  gap={3}
                  wrap
                >
                  <Text as="h2" id="team-access-heading" variant="h4">
                    Team access
                  </Text>
                  <Stack direction="row" gap={2} wrap>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busy || loading}
                      onClick={retryCatalogue}
                    >
                      Refresh team access
                    </Button>
                    <Button
                      variant="secondary"
                      disabled={busy}
                      onClick={openEnrollment}
                    >
                      Enroll into a team
                    </Button>
                  </Stack>
                </Stack>
                {loading ? <Text>Checking team access…</Text> : null}
                {catalogue?.teams.map((entry) => (
                  <div key={entry.teamId} className="teams-view__team">
                    <Stack gap={3}>
                      <Stack
                        direction="row"
                        justify="space-between"
                        align="center"
                        wrap
                        gap={3}
                      >
                        <Text as="h3" weight="semibold">
                          {teamLabel(entry.teamId, entry.teamName)}
                        </Text>
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
                      {entry.blockers.length ? (
                        <Text variant="caption" color="error">
                          {entry.blockers[0].message} {entry.blockers[0].remedy}
                        </Text>
                      ) : null}
                      <Disclosure summary="Credential details">
                        <Stack gap={2}>
                          <Text variant="caption" mono>
                            {entry.teamId}
                          </Text>
                          {entry.credential ? (
                            <Text variant="caption" color="secondary">
                              Last verified{' '}
                              {new Date(
                                entry.credential.verifiedAt,
                              ).toLocaleString()}
                            </Text>
                          ) : null}
                          {entry.blockers.slice(1).map((blocker) => (
                            <Text
                              key={blocker.code}
                              variant="caption"
                              color="secondary"
                            >
                              {blocker.message} {blocker.remedy}
                            </Text>
                          ))}
                        </Stack>
                      </Disclosure>
                      <Stack direction="row" gap={2} wrap>
                        <Button
                          variant="secondary"
                          disabled={busy}
                          onClick={() => {
                            setFeedback(null);
                            setTeam({ ...entry });
                            setMode('replace');
                            setReviewOpen(true);
                            setScopes(scopesForRenewal(entry));
                            setDestinationTeamId('');
                          }}
                        >
                          Renew
                        </Button>
                        {actions.setTeamVisibility ? (
                          <Button
                            variant="ghost"
                            disabled={busy}
                            onClick={() => setRemoveTarget(entry)}
                          >
                            Remove from Desktop
                          </Button>
                        ) : null}
                      </Stack>
                    </Stack>
                  </div>
                ))}

                {catalogue && !catalogue.teams.length ? (
                  <Text color="secondary">
                    No teams shown here. Enroll an agent or restore a removed
                    team.
                  </Text>
                ) : null}
                {catalogue?.hiddenTeamIds?.length ? (
                  <Disclosure
                    summary="Removed from Desktop"
                    hint={`${catalogue.hiddenTeamIds.length} teams`}
                  >
                    <Stack gap={3}>
                      <Text variant="caption" color="secondary">
                        These teams remain in the shared identity. Restore one
                        to show its current credential, or renew access when you
                        have team approval.
                      </Text>
                      {catalogue.hiddenTeamIds.map((teamId) => (
                        <Stack
                          key={teamId}
                          direction="row"
                          justify="space-between"
                          align="center"
                          wrap
                          gap={2}
                        >
                          <Text>{teamLabel(teamId)}</Text>
                          <Stack direction="row" gap={2} wrap>
                            <Button
                              variant="secondary"
                              disabled={busy}
                              onClick={() =>
                                void setTeamVisibility(teamId, false)
                              }
                            >
                              Restore
                            </Button>
                            <Button
                              variant="secondary"
                              disabled={busy}
                              onClick={() => {
                                setFeedback(null);
                                setTeam({
                                  teamId,
                                  teamName: teamId,
                                  available: false,
                                  blockers: [],
                                  diaries: [],
                                  defaultDiaryId: null,
                                });
                                setMode('replace');
                                setReviewOpen(true);
                                setScopes([...AGENT_CREDENTIAL_SCOPES]);
                                setDestinationTeamId('');
                              }}
                            >
                              Renew access
                            </Button>
                          </Stack>
                        </Stack>
                      ))}
                    </Stack>
                  </Disclosure>
                ) : null}
              </Stack>
            </section>
          ) : null}
          {identity && recoveries.length ? (
            <Disclosure
              summary="Credential recovery"
              hint={`${recoveries.length} saved records`}
            >
              <Stack gap={3}>
                <Text variant="caption" color="secondary">
                  These records are stored on the Agent Server machine. Captured
                  credentials can be restored here without exposing the secret.
                </Text>
                {recoveries.map((record) => (
                  <Stack key={record.recoveryId} gap={2}>
                    <Text>
                      {record.teamId ?? 'Team'} ·{' '}
                      {record.operation ?? 'enrollment'} ·{' '}
                      {new Date(record.createdAt).toLocaleString()}
                    </Text>
                    {record.secretCaptured ? (
                      <Button
                        variant="secondary"
                        disabled={busy || !actions.restoreEnrollment}
                        onClick={async () => {
                          setBusy(true);
                          try {
                            await actions.restoreEnrollment?.(
                              identity,
                              record.recoveryId,
                            );
                            setRecoveryVersion((value) => value + 1);
                            retryCatalogue();
                            await actions.refresh?.();
                            setFeedback({
                              title: 'Credential restored',
                              message:
                                'Team access was verified on the Agent Server.',
                              error: false,
                            });
                          } catch {
                            setFeedback({
                              title: 'Credential recovery incomplete',
                              message:
                                'The recovery record was kept on the Agent Server. Check its secret provider and team access, then try again.',
                              error: true,
                            });
                          } finally {
                            setBusy(false);
                          }
                        }}
                      >
                        Restore captured credential
                      </Button>
                    ) : (
                      <Text variant="caption" color="secondary">
                        No credential secret was captured. Check team access
                        before requesting another approval.
                      </Text>
                    )}
                    <Button
                      variant="secondary"
                      disabled={busy || !actions.discardEnrollmentRecovery}
                      onClick={() =>
                        setDiscardTarget({
                          identity,
                          recoveryId: record.recoveryId,
                          secretCaptured: record.secretCaptured,
                        })
                      }
                    >
                      Discard record
                    </Button>
                  </Stack>
                ))}
              </Stack>
            </Disclosure>
          ) : null}
          {identity && recoveriesError ? (
            <InlineNotice tone="warning" title="Recovery records unavailable">
              {recoveriesError === 'unsupported'
                ? 'Recovery controls require an updated Agent Server. Update it, then refresh team access.'
                : 'Could not load recovery records. Check the Agent Server connection and try again.'}
            </InlineNotice>
          ) : null}
        </>
      ) : null}
      {identity && reviewOpen ? (
        <section
          ref={renewalForm}
          className="teams-view__review"
          tabIndex={-1}
          aria-labelledby="team-approval-heading"
        >
          <ControlSurface>
            <Stack gap={4}>
              <Button
                variant="ghost"
                disabled={busy}
                style={{ alignSelf: 'flex-start' }}
                onClick={() => {
                  setReviewOpen(false);
                  setFeedback(null);
                  setTeam(null);
                }}
              >
                Back to team access
              </Button>
              <Text id="team-approval-heading" as="h2" variant="h4">
                {mode === 'replace'
                  ? `Renew ${team ? teamLabel(team.teamId, team.teamName) : 'team access'}`
                  : 'Enroll into a team'}
              </Text>
              <Text variant="caption" color="secondary">
                Agent: {identity} · Approval account:{' '}
                {data.operatorEmail ??
                  (data.operatorConfigured ? 'Signed in' : 'Not signed in')}
              </Text>
              {mode === 'replace' && team ? (
                <Text variant="caption" color="secondary" mono>
                  Team ID: {team.teamId}
                </Text>
              ) : null}
              {feedback?.error ? (
                <div ref={errorNotice} tabIndex={-1}>
                  <InlineNotice
                    tone={feedback.error ? 'error' : 'success'}
                    title={feedback.title}
                  >
                    {feedback.message}
                  </InlineNotice>
                </div>
              ) : null}
              {pendingApproval?.kind === 'enrollment' ? approvalStatus : null}
              {!pendingApproval ? (
                <>
                  {mode === 'replace' &&
                  !feedback?.error &&
                  operatorTeamsLoaded &&
                  !operatorTeams.some(({ id }) => id === team?.teamId) ? (
                    <InlineNotice
                      tone="warning"
                      title="Operator access not confirmed"
                    >
                      Your signed-in account does not list this team. Ask a team
                      owner to grant credential-management access, then refresh
                      operator teams. Refreshing alone does not grant access.
                      You can still request approval if access changed since
                      your last refresh.
                    </InlineNotice>
                  ) : null}
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
                            setDestinationTeamId(
                              value === 'manual' ? '' : value,
                            );
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
                          Active project teams you can enroll agents into, from
                          your last operator approval.
                        </Text>
                      ) : null}
                      {operatorTeamsError ? (
                        <InlineNotice
                          tone="warning"
                          title="Team choices unavailable"
                        >
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
                    Console will show the selected identity, team and
                    permissions before you approve.
                  </Text>
                  {mode === 'replace' &&
                  team?.credential?.scopes?.some(
                    (scope) =>
                      !(TEAM_AGENT_KEY_SCOPES as readonly string[]).includes(
                        scope,
                      ),
                  ) ? (
                    <InlineNotice
                      tone="warning"
                      title="Permissions will change"
                    >
                      This renewal cannot retain permissions outside the Desktop
                      team credential set. Review the selected permissions
                      before approval.
                    </InlineNotice>
                  ) : null}
                  <Stack gap={3}>
                    <Text as="h3" weight="semibold">
                      Permissions
                    </Text>
                    <Disclosure
                      summary={`${DAEMON_MINIMUM_SCOPES.length} required permissions`}
                      hint="Included for every run"
                    >
                      <Stack gap={2}>
                        {DAEMON_MINIMUM_SCOPES.map((scope) => (
                          <Text key={scope} variant="caption" color="secondary">
                            {CREDENTIAL_SCOPE_DESCRIPTIONS[scope]} · {scope}
                          </Text>
                        ))}
                      </Stack>
                    </Disclosure>
                    <Text variant="caption" color="secondary">
                      Choose the additional access this team should grant.
                    </Text>
                    {TEAM_AGENT_KEY_SCOPES.filter(
                      (scope) =>
                        !(DAEMON_MINIMUM_SCOPES as readonly string[]).includes(
                          scope,
                        ),
                    ).map((scope) => (
                      <label key={scope} className="teams-view__permission">
                        <input
                          type="checkbox"
                          checked={scopes.includes(scope)}
                          disabled={busy}
                          onChange={(event) =>
                            setScopes((current) =>
                              event.target.checked
                                ? [...current, scope]
                                : current.filter((item) => item !== scope),
                            )
                          }
                        />
                        <span>
                          {CREDENTIAL_SCOPE_DESCRIPTIONS[scope]}
                          <Text as="span" variant="caption" color="secondary">
                            {scope}
                          </Text>
                        </span>
                      </label>
                    ))}
                  </Stack>
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
                </>
              ) : null}
            </Stack>
          </ControlSurface>
        </section>
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
        open={removeTarget !== null}
        title={`Remove ${removeTarget?.teamName ?? 'this team'} from Desktop?`}
        message="This hides the team here and prevents new runs from using it. Existing runs continue. The shared CLI credential and remote team membership remain available; you can restore the team here later."
        confirmLabel="Remove from Desktop"
        onCancel={() => setRemoveTarget(null)}
        onConfirm={() => {
          if (removeTarget) void setTeamVisibility(removeTarget.teamId, true);
        }}
      />
      <ConfirmDialog
        open={confirm}
        title={`Replace the credential for ${team ? teamLabel(team.teamId, team.teamName) : 'this team'}?`}
        message="Future runs will use the replacement. Existing runs keep their predecessor credential until stopped or expired; restart them when ready."
        confirmLabel="Replace credential"
        onCancel={() => setConfirm(false)}
        onConfirm={() => void submit()}
      />
      <ConfirmDialog
        open={discardTarget !== null}
        title="Discard this recovery record?"
        destructive
        message={
          discardTarget?.secretCaptured
            ? 'This record may hold the only local copy of the issued credential. Discarding it cannot be undone. Restore it or verify team access first.'
            : 'This record has retry context but no captured credential. Discarding it removes that context. Check team access before requesting another approval.'
        }
        confirmLabel="Discard local record"
        onCancel={() => setDiscardTarget(null)}
        onConfirm={() => {
          const target = discardTarget;
          if (!target || !actions.discardEnrollmentRecovery) return;
          setBusy(true);
          void actions
            .discardEnrollmentRecovery(
              target.identity,
              target.recoveryId,
              target.secretCaptured,
            )
            .then(() => {
              setRecoveryVersion((value) => value + 1);
              setFeedback({
                title: 'Recovery record discarded',
                message: 'The local recovery record was removed.',
                error: false,
              });
            })
            .catch(() => {
              setFeedback({
                title: 'Recovery record was kept',
                message: 'Refresh the recovery list and try again.',
                error: true,
              });
            })
            .finally(() => {
              setDiscardTarget(null);
              setBusy(false);
            });
        }}
      />
    </Stack>
  );
}
