import {
  Badge,
  Button,
  ControlSurface,
  DescriptionList,
  Divider,
  InlineNotice,
  Input,
  Select,
  Stack,
  Text,
  useTheme,
} from '@themoltnet/design-system';
import { useMemo, useState } from 'react';

import { relativeTime } from './format.js';
import type {
  ProfileSummary,
  RunCenterActions,
  RunCenterData,
} from './types.js';

export interface RunComposerProps {
  data: RunCenterData;
  actions: RunCenterActions;
  /** Prefills from a saved preset when set. */
  presetId: string | null;
  now: number;
  onDone: () => void;
}

export function RunComposer({
  data,
  actions,
  presetId,
  now,
  onDone,
}: RunComposerProps) {
  const preset = presetId
    ? (data.presets.find((candidate) => candidate.id === presetId) ?? null)
    : null;

  const [agent, setAgent] = useState(
    preset?.agent ?? data.agents[0]?.agentName ?? '',
  );
  const [teamId, setTeamId] = useState(preset?.teamId ?? data.teams[0]?.id ?? '');
  const [primaryId, setPrimaryId] = useState(preset?.profileIds[0] ?? '');
  const [fallbackIds, setFallbackIds] = useState<string[]>(
    preset?.profileIds.slice(1) ?? [],
  );
  const [taskTypes, setTaskTypes] = useState<string[]>(
    preset?.taskTypes ?? ['freeform'],
  );
  const [advancedOpen, setAdvancedOpen] = useState(
    (preset?.profileIds.length ?? 0) > 1,
  );
  const [presetName, setPresetName] = useState(preset?.name ?? '');
  const [savePreset, setSavePreset] = useState(Boolean(preset));
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const selectedAgent = data.agents.find(
    (candidate) => candidate.agentName === agent,
  );
  const primary = data.profiles.find((candidate) => candidate.id === primaryId);
  const team = data.teams.find((candidate) => candidate.id === teamId);

  const boundElsewhere = Boolean(
    selectedAgent &&
      selectedAgent.kind === 'managed' &&
      selectedAgent.boundTeamId &&
      selectedAgent.boundTeamId !== teamId,
  );

  const availableFallbacks = useMemo(
    () =>
      data.profiles.filter(
        (candidate) =>
          candidate.id !== primaryId && !fallbackIds.includes(candidate.id),
      ),
    [data.profiles, primaryId, fallbackIds],
  );

  const problems: string[] = [];
  if (!agent) problems.push('Choose an identity.');
  if (!teamId) problems.push('Choose a team.');
  if (!primaryId) problems.push('Choose a runtime profile.');
  if (taskTypes.length === 0) problems.push('Choose at least one task type.');
  if (boundElsewhere)
    problems.push(
      `${agent} is key-bound to another team and cannot claim work for ${team?.name ?? 'this team'}.`,
    );
  if (savePreset && !presetName.trim())
    problems.push('Name the preset, or turn off saving.');

  const canStart = problems.length === 0 && Boolean(primary?.ready);

  const start = async () => {
    setBusy(true);
    setSubmitError(null);
    try {
      if (savePreset) {
        await actions.savePreset({
          id: preset?.id ?? null,
          name: presetName.trim(),
          agent,
          teamId,
          profileIds: [primaryId, ...fallbackIds],
          taskTypes,
          mode: 'poll',
        });
      }
      await actions.startRun({
        agent,
        teamId,
        profileIds: [primaryId, ...fallbackIds],
        taskTypes,
        mode: 'poll',
        presetName: savePreset ? presetName.trim() : (preset?.name ?? null),
      });
      onDone();
    } catch (error) {
      setSubmitError(
        error instanceof Error
          ? error.message
          : 'The run could not be started. Check the Server view.',
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Stack gap={6} style={{ maxWidth: '46rem' }}>
      <Stack gap={2}>
        <Button
          variant="ghost"
          size="sm"
          onClick={onDone}
          style={{ alignSelf: 'flex-start' }}
        >
          ← Runs
        </Button>
        <Text as="h1" variant="h4">
          {preset ? `Start “${preset.name}”` : 'New run'}
        </Text>
        <Text variant="caption" color="secondary">
          {preset
            ? `Saved on this Mac${preset.lastUsedAt ? `, last used ${relativeTime(preset.lastUsedAt, now)}` : ' and not used yet'}. Nothing starts until you press Start run.`
            : 'One worker process that claims matching tasks for a team until you stop it.'}
        </Text>
      </Stack>

      <ControlSurface padding="md" as="section">
        <Stack gap={5}>
          <div className="field-grid">
            <Select
              label="Identity"
              value={agent}
              onChange={(event) => setAgent(event.target.value)}
              hint={
                selectedAgent?.fingerprint
                  ? `Agent key ${selectedAgent.fingerprint}`
                  : undefined
              }
            >
              {data.agents.map((candidate) => (
                <option key={candidate.agentName} value={candidate.agentName}>
                  {candidate.agentName}
                </option>
              ))}
            </Select>
            <Select
              label="Team"
              value={teamId}
              onChange={(event) => setTeamId(event.target.value)}
              error={
                boundElsewhere
                  ? `${agent} cannot claim work for this team`
                  : undefined
              }
            >
              {data.teams.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.name}
                </option>
              ))}
            </Select>
          </div>

          {boundElsewhere ? (
            <InlineNotice tone="error" title="Identity is bound to another team">
              A managed agent key is issued for one team. Create an identity for{' '}
              {team?.name} in Console with an invitation from that team, or
              switch the team back.
            </InlineNotice>
          ) : null}

          <Divider style={{ margin: 0 }} />

          <Stack gap={3}>
            <Select
              label="Runtime profile"
              value={primaryId}
              onChange={(event) => setPrimaryId(event.target.value)}
              hint="Profiles are authored in Console. This is the policy the run executes under."
            >
              <option value="">Select a profile…</option>
              {data.profiles.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.name}
                  {candidate.ready ? '' : ' — not ready on this Mac'}
                </option>
              ))}
            </Select>
            {primary ? <ProfileInspector profile={primary} /> : null}
          </Stack>

          <Divider style={{ margin: 0 }} />

          <TaskTypePicker
            options={data.capabilities.taskTypes}
            selected={taskTypes}
            onChange={setTaskTypes}
          />

          <Divider style={{ margin: 0 }} />

          <Stack gap={2}>
            <Text variant="caption" color="muted">
              Mode
            </Text>
            <Stack direction="row" gap={2} align="center" wrap>
              <Badge variant="primary">poll</Badge>
              <Text variant="caption" color="secondary">
                Keeps claiming matching tasks until you stop it. The desktop app
                runs polling workers only.
              </Text>
            </Stack>
          </Stack>
        </Stack>
      </ControlSurface>

      <ControlSurface padding="none" as="section">
        <details
          className="detail-section"
          open={advancedOpen || undefined}
          onToggle={(event) =>
            setAdvancedOpen((event.target as HTMLDetailsElement).open)
          }
        >
          <summary>
            <span>
              <Text as="span" variant="h4">
                Advanced
              </Text>
              <Text as="span" variant="caption" color="muted">
                {fallbackIds.length
                  ? `${fallbackIds.length} fallback profile${fallbackIds.length === 1 ? '' : 's'}`
                  : 'Fallback profiles'}
              </Text>
            </span>
          </summary>
          <Stack className="detail-content" gap={4}>
            <Text variant="caption" color="secondary">
              If the primary profile cannot run — its provider key is missing,
              its runtime kind is not registered — the worker tries these in
              order instead of failing the task.
            </Text>
            <FallbackList
              profiles={data.profiles}
              fallbackIds={fallbackIds}
              available={availableFallbacks}
              onChange={setFallbackIds}
            />
          </Stack>
        </details>
      </ControlSurface>

      {primary && !primary.ready ? (
        <InlineNotice
          tone="error"
          title={`${primary.name} cannot run on this Mac`}
        >
          <Stack gap={2}>
            {primary.blockers.map((blocker) => (
              <Text key={blocker.code} variant="caption">
                {blocker.message} {blocker.remedy}
              </Text>
            ))}
          </Stack>
        </InlineNotice>
      ) : null}

      {submitError ? (
        <InlineNotice tone="error" title="The run did not start">
          {submitError}
        </InlineNotice>
      ) : null}

      <ControlSurface padding="md" as="section">
        <Stack gap={4}>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={savePreset}
              onChange={(event) => setSavePreset(event.target.checked)}
            />
            <Stack gap={0.5}>
              <Text as="span" weight="medium">
                Save as a preset
              </Text>
              <Text as="span" variant="caption" color="muted">
                Kept on this Mac only. Presets never start on their own.
              </Text>
            </Stack>
          </label>
          {savePreset ? (
            <Input
              label="Preset name"
              value={presetName}
              placeholder="Nightly digest"
              onChange={(event) => setPresetName(event.target.value)}
            />
          ) : null}
        </Stack>
      </ControlSurface>

      <Stack direction="row" justify="space-between" align="center" gap={4} wrap>
        <Stack gap={1}>
          {problems.length ? (
            <Text variant="caption" color="error">
              {problems[0]}
            </Text>
          ) : (
            <Text variant="caption" color="muted">
              Starts one worker process on this machine.
            </Text>
          )}
        </Stack>
        <Stack direction="row" gap={3}>
          {preset ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void actions.deletePreset(preset.id).then(onDone)}
            >
              Delete preset
            </Button>
          ) : null}
          <Button variant="secondary" size="sm" onClick={onDone}>
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={!canStart}
            loading={busy}
            loadingLabel="Starting run"
            onClick={() => void start()}
          >
            Start run
          </Button>
        </Stack>
      </Stack>
    </Stack>
  );
}

/** Read-only profile inspection. Authoring stays in Console, by decision. */
function ProfileInspector({ profile }: { profile: ProfileSummary }) {
  const theme = useTheme();
  return (
    <div
      style={{
        borderTop: `1px solid ${theme.color.border.DEFAULT}`,
        paddingTop: theme.spacing[4],
      }}
    >
      <Stack gap={3}>
        {profile.description ? (
          <Text variant="caption" color="secondary">
            {profile.description}
          </Text>
        ) : null}
        <DescriptionList
          ariaLabel={`${profile.name} profile settings`}
          columns={3}
          compact
          items={[
            { label: 'Provider', value: profile.provider, mono: true },
            { label: 'Model', value: profile.model, mono: true },
            { label: 'Runtime', value: profile.runtimeKind, mono: true },
            {
              label: 'Tool policy',
              value: profile.toolEnforcement,
              mono: true,
            },
            {
              label: 'Workspace',
              value: profile.defaultWorkspaceMode ?? 'none',
              mono: true,
            },
            { label: 'Max turns', value: String(profile.maxTurns), mono: true },
          ]}
        />
        <Stack direction="row" gap={3} align="center" wrap>
          {profile.ready ? (
            <Badge variant="success">ready on this Mac</Badge>
          ) : (
            <Badge variant="error">not ready</Badge>
          )}
          <Text as="span" variant="caption" color="muted" mono>
            rev {profile.revision} · {profile.definitionCid.slice(0, 12)}…
          </Text>
          {profile.requiredEnv.length ? (
            <Text as="span" variant="caption" color="muted">
              needs {profile.requiredEnv.join(', ')}
            </Text>
          ) : null}
        </Stack>
      </Stack>
    </div>
  );
}

function TaskTypePicker({
  options,
  selected,
  onChange,
}: {
  options: RunCenterData['capabilities']['taskTypes'];
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  const toggle = (type: string) =>
    onChange(
      selected.includes(type)
        ? selected.filter((value) => value !== type)
        : [...selected, type],
    );
  return (
    <fieldset className="chip-group">
      <legend>
        <Text as="span" variant="caption" color="muted">
          Task types this worker may claim
        </Text>
      </legend>
      <div className="chip-group__items">
        {options.map((option) => (
          <label
            key={option.type}
            className="chip"
            data-checked={selected.includes(option.type) || undefined}
            title={option.summary}
          >
            <input
              type="checkbox"
              checked={selected.includes(option.type)}
              onChange={() => toggle(option.type)}
            />
            <span>{option.type}</span>
          </label>
        ))}
      </div>
      <Text variant="caption" color="muted">
        {selected.length === 0
          ? 'Select at least one. A worker only claims the types you allow.'
          : `Claims ${selected.length} of ${options.length} types. Anything else stays in the queue for another worker.`}
      </Text>
    </fieldset>
  );
}

function FallbackList({
  profiles,
  fallbackIds,
  available,
  onChange,
}: {
  profiles: ProfileSummary[];
  fallbackIds: string[];
  available: ProfileSummary[];
  onChange: (next: string[]) => void;
}) {
  const theme = useTheme();
  const move = (index: number, delta: number) => {
    const next = [...fallbackIds];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  };

  return (
    <Stack gap={3}>
      {fallbackIds.length ? (
        <ol className="fallback-list">
          {fallbackIds.map((id, index) => {
            const profile = profiles.find((candidate) => candidate.id === id);
            return (
              <li key={id}>
                <Text as="span" variant="caption" mono color="muted">
                  {index + 1}
                </Text>
                <Stack gap={0.5} style={{ flex: 1, minWidth: 0 }}>
                  <Text as="span" weight="medium">
                    {profile?.name ?? id}
                  </Text>
                  <Text as="span" variant="caption" color="muted" mono>
                    {profile
                      ? `${profile.provider} · ${profile.model}`
                      : 'unknown profile'}
                  </Text>
                </Stack>
                <Stack direction="row" gap={1}>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`Move ${profile?.name ?? id} earlier`}
                    disabled={index === 0}
                    onClick={() => move(index, -1)}
                  >
                    ↑
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`Move ${profile?.name ?? id} later`}
                    disabled={index === fallbackIds.length - 1}
                    onClick={() => move(index, 1)}
                  >
                    ↓
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`Remove ${profile?.name ?? id}`}
                    onClick={() =>
                      onChange(fallbackIds.filter((value) => value !== id))
                    }
                  >
                    ✕
                  </Button>
                </Stack>
              </li>
            );
          })}
        </ol>
      ) : (
        <Text variant="caption" color="muted">
          No fallbacks. The run fails if the primary profile cannot execute.
        </Text>
      )}
      {available.length ? (
        <Select
          label="Add a fallback"
          value=""
          onChange={(event) => {
            if (event.target.value)
              onChange([...fallbackIds, event.target.value]);
          }}
          style={{ maxWidth: '20rem' }}
        >
          <option value="">Select a profile…</option>
          {available.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {candidate.name}
            </option>
          ))}
        </Select>
      ) : (
        <Text variant="caption" color="muted" style={{ color: theme.color.text.muted }}>
          Every profile in this team is already in the chain.
        </Text>
      )}
    </Stack>
  );
}
