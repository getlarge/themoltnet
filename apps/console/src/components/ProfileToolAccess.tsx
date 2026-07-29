import {
  type RuntimeProfile,
  setRuntimeProfilePolicies,
  updateRuntimeProfile,
} from '@moltnet/api-client';
import {
  getRuntimeProfileAllowedToolsOptions,
  getRuntimeProfilePoliciesOptions,
  listRuntimePoliciesOptions,
} from '@moltnet/api-client/query';
import { useQuery } from '@tanstack/react-query';
import {
  Badge,
  Button,
  Stack,
  Text,
  useTheme,
} from '@themoltnet/design-system';
import { useEffect, useMemo, useState } from 'react';

import { getApiClient } from '../api.js';
import { getApiErrorDetail } from '../api-error.js';
import { canManageRuntime, TEAM_HEADER } from '../team/permissions.js';
import { useTeam } from '../team/useTeam.js';

type EnforcementMode = RuntimeProfile['toolEnforcement'];

const MODE_OPTIONS: Array<{
  value: EnforcementMode;
  label: string;
  description: string;
}> = [
  {
    value: 'off',
    label: 'Off',
    description: 'No gate. Tools run unchecked and no allow-set is fetched.',
  },
  {
    value: 'watch',
    label: 'Watch',
    description: 'Audit would-block calls while allowing the workload to run.',
  },
  {
    value: 'enforce',
    label: 'Enforce',
    description:
      'Block disallowed tools and fail closed if policy resolution fails.',
  },
];

export function ProfileToolAccess({
  profile,
  onProfileUpdated,
}: {
  profile: Pick<RuntimeProfile, 'id' | 'toolEnforcement'>;
  onProfileUpdated: () => Promise<unknown>;
}) {
  const theme = useTheme();
  const { selectedTeam } = useTeam();
  const teamId = selectedTeam?.id;
  const canManage = canManageRuntime(selectedTeam?.role);
  const [mode, setMode] = useState<EnforcementMode>(
    profile.toolEnforcement ?? 'off',
  );
  const [selectedPolicyIds, setSelectedPolicyIds] = useState<string[]>([]);
  const [draftProfileId, setDraftProfileId] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveNotice, setSaveNotice] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const policiesQuery = useQuery({
    ...listRuntimePoliciesOptions({
      client: getApiClient(),
      headers: { [TEAM_HEADER]: teamId ?? '' },
    }),
    enabled: Boolean(teamId),
  });
  const bindingsQuery = useQuery({
    ...getRuntimeProfilePoliciesOptions({
      client: getApiClient(),
      headers: { [TEAM_HEADER]: teamId ?? '' },
      path: { profileId: profile.id },
    }),
    enabled: Boolean(teamId),
  });
  const allowedToolsQuery = useQuery({
    ...getRuntimeProfileAllowedToolsOptions({
      client: getApiClient(),
      headers: { [TEAM_HEADER]: teamId ?? '' },
      path: { profileId: profile.id },
    }),
    enabled: Boolean(teamId),
  });

  const policies = useMemo(
    () => policiesQuery.data?.items ?? [],
    [policiesQuery.data],
  );
  const allowedTools = allowedToolsQuery.data?.allowedTools ?? [];
  const allowedShellCommands =
    allowedToolsQuery.data?.allowedShellCommands ?? [];

  useEffect(() => {
    setMode(profile.toolEnforcement ?? 'off');
  }, [profile.toolEnforcement]);

  useEffect(() => {
    setSelectedPolicyIds([]);
    setDraftProfileId(null);
    setSaveError(null);
    setSaveNotice(null);
  }, [profile.id]);

  useEffect(() => {
    if (bindingsQuery.data && draftProfileId !== profile.id) {
      setSelectedPolicyIds(bindingsQuery.data.policyIds);
      setDraftProfileId(profile.id);
    }
  }, [bindingsQuery.data, draftProfileId, profile.id]);

  function togglePolicy(policyId: string) {
    setSelectedPolicyIds((current) =>
      current.includes(policyId)
        ? current.filter((id) => id !== policyId)
        : [...current, policyId],
    );
  }

  async function saveToolAccess() {
    if (!teamId) return;
    setIsSaving(true);
    setSaveError(null);
    setSaveNotice(null);
    let bindingsSaved = false;
    try {
      const bindingResult = await setRuntimeProfilePolicies({
        client: getApiClient(),
        headers: { [TEAM_HEADER]: teamId },
        path: { profileId: profile.id },
        body: { policyIds: selectedPolicyIds },
      });
      if (bindingResult.error) {
        throw new Error(
          getApiErrorDetail(
            bindingResult.error,
            'Failed to bind tool policies.',
          ),
        );
      }
      bindingsSaved = true;

      const profileResult = await updateRuntimeProfile({
        client: getApiClient(),
        path: { profileId: profile.id },
        body: { toolEnforcement: mode },
      });
      if (profileResult.error) {
        throw new Error(
          getApiErrorDetail(
            profileResult.error,
            'Policies were saved, but enforcement mode was not updated.',
          ),
        );
      }

      await Promise.all([
        bindingsQuery.refetch(),
        allowedToolsQuery.refetch(),
        onProfileUpdated(),
      ]);
      setDraftProfileId(profile.id);
      setSaveNotice(
        'Tool access saved. New policy snapshots apply when the next runtime session starts.',
      );
    } catch (error) {
      if (bindingsSaved) {
        setMode(profile.toolEnforcement ?? 'off');
        await Promise.allSettled([
          bindingsQuery.refetch(),
          allowedToolsQuery.refetch(),
          onProfileUpdated(),
        ]);
        setDraftProfileId(profile.id);
      }
      setSaveError(
        bindingsSaved
          ? `${getApiErrorDetail(
              error,
              'Policies were saved, but enforcement mode was not updated.',
            )} The saved policy bindings and current mode have been reloaded; review them before retrying.`
          : getApiErrorDetail(error, 'Failed to save tool access.'),
      );
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <section
      aria-labelledby="profile-tool-access-heading"
      style={{
        borderTop: `1px solid ${theme.color.border.DEFAULT}`,
        paddingTop: theme.spacing[5],
      }}
    >
      <Stack gap={4}>
        <Stack gap={1}>
          <div id="profile-tool-access-heading">
            <Text variant="h3">Tool access</Text>
          </div>
          <Text color="muted">
            Start in Watch, curate the observed tool set, then move to Enforce.
            Changes are snapshotted by the next runtime session.
          </Text>
        </Stack>

        <fieldset
          disabled={!canManage || isSaving}
          style={{ border: 0, padding: 0, margin: 0 }}
        >
          <legend
            style={{
              marginBottom: theme.spacing[2],
              fontWeight: theme.font.weight.medium,
            }}
          >
            Enforcement mode
          </legend>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
              gap: theme.spacing[2],
            }}
          >
            {MODE_OPTIONS.map((option) => {
              const selected = mode === option.value;
              return (
                <label
                  key={option.value}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'auto minmax(0, 1fr)',
                    gap: theme.spacing[2],
                    alignItems: 'start',
                    padding: theme.spacing[3],
                    border: `1px solid ${
                      selected
                        ? theme.color.primary.DEFAULT
                        : theme.color.border.DEFAULT
                    }`,
                    borderRadius: theme.radius.md,
                    background: theme.color.bg.surface,
                    cursor: canManage ? 'pointer' : 'default',
                  }}
                >
                  <input
                    type="radio"
                    name={`tool-enforcement-${profile.id}`}
                    value={option.value}
                    checked={selected}
                    onChange={() => setMode(option.value)}
                  />
                  <Stack gap={1}>
                    <Text weight="semibold">{option.label}</Text>
                    <Text variant="caption" color="muted">
                      {option.description}
                    </Text>
                  </Stack>
                </label>
              );
            })}
          </div>
        </fieldset>

        <Stack gap={2}>
          <Text weight="medium">Bound policies</Text>
          {policiesQuery.isLoading || bindingsQuery.isLoading ? (
            <Text color="muted">Loading policy bindings…</Text>
          ) : policiesQuery.error || bindingsQuery.error ? (
            <Stack gap={2}>
              <div role="alert">
                <Text color="muted">
                  Failed to load profile policy bindings.
                </Text>
              </div>
              <div>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() =>
                    void Promise.all([
                      policiesQuery.refetch(),
                      bindingsQuery.refetch(),
                    ])
                  }
                >
                  Retry
                </Button>
              </div>
            </Stack>
          ) : policies.length === 0 ? (
            <Text variant="caption" color="muted">
              No reusable policies exist for this team. Create one in the
              Policies tab, then return here to bind it.
            </Text>
          ) : (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                gap: theme.spacing[2],
              }}
            >
              {policies.map((policy) => (
                <label
                  key={policy.id}
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: theme.spacing[2],
                    padding: theme.spacing[3],
                    border: `1px solid ${theme.color.border.DEFAULT}`,
                    borderRadius: theme.radius.md,
                    background: theme.color.bg.surface,
                  }}
                >
                  <input
                    type="checkbox"
                    checked={selectedPolicyIds.includes(policy.id)}
                    disabled={!canManage || isSaving}
                    onChange={() => togglePolicy(policy.id)}
                  />
                  <Stack gap={1}>
                    <Text weight="medium">{policy.name}</Text>
                    <Text variant="caption" color="muted">
                      {policy.description || 'No description'}
                    </Text>
                  </Stack>
                </label>
              ))}
            </div>
          )}
        </Stack>

        <Stack gap={3}>
          <Stack direction="row" align="center" gap={2} wrap>
            <Text weight="medium">Resolved access</Text>
            <Badge
              variant={
                allowedToolsQuery.data?.enforcement === 'enforce'
                  ? 'warning'
                  : 'default'
              }
            >
              {allowedToolsQuery.data?.enforcement ?? profile.toolEnforcement}
            </Badge>
          </Stack>
          {allowedToolsQuery.isLoading ? (
            <Text color="muted">Resolving allowed tools…</Text>
          ) : allowedToolsQuery.error ? (
            <div role="alert">
              <Text variant="caption" color="muted">
                Failed to resolve the effective tool set.
              </Text>
            </div>
          ) : (
            <Stack gap={3}>
              <Stack gap={2}>
                <Text variant="caption" weight="medium">
                  Exact tools
                </Text>
                {allowedTools.length === 0 ? (
                  <Text variant="caption" color="muted">
                    No broad tool grants resolve from the bound policies.
                  </Text>
                ) : (
                  <Stack direction="row" gap={2} wrap>
                    {allowedTools.map((tool) => (
                      <Badge key={tool} variant="primary">
                        <code style={{ fontFamily: theme.font.family.mono }}>
                          {tool}
                        </code>
                      </Badge>
                    ))}
                  </Stack>
                )}
              </Stack>
              <Stack gap={2}>
                <Text variant="caption" weight="medium">
                  Allowed shell commands
                </Text>
                {allowedShellCommands.length === 0 ? (
                  <Text variant="caption" color="muted">
                    No scoped shell commands resolve from the bound policies.
                  </Text>
                ) : (
                  <Stack gap={1}>
                    {allowedShellCommands.map((rule) => (
                      <code
                        key={JSON.stringify(rule.argvPrefix)}
                        style={{
                          display: 'block',
                          fontFamily: theme.font.family.mono,
                          fontSize: theme.font.size.sm,
                          overflowWrap: 'anywhere',
                        }}
                      >
                        {rule.argvPrefix.join(' › ')} › …
                      </code>
                    ))}
                  </Stack>
                )}
              </Stack>
              {allowedTools.length === 0 &&
              allowedShellCommands.length === 0 ? (
                <Text variant="caption" color="muted">
                  The resolved access set is empty. Enforce mode will block
                  every tool call; this is valid when intentional.
                </Text>
              ) : null}
            </Stack>
          )}
        </Stack>

        {!canManage ? (
          <Text variant="caption" color="muted">
            You can inspect this configuration, but changing it requires the
            team manage-runtime role.
          </Text>
        ) : null}
        {saveError ? (
          <div role="alert">
            <Text
              variant="caption"
              style={{ color: theme.color.error.DEFAULT }}
            >
              {saveError}
            </Text>
          </div>
        ) : null}
        {saveNotice ? (
          <div role="status">
            <Text
              variant="caption"
              style={{ color: theme.color.success.DEFAULT }}
            >
              {saveNotice}
            </Text>
          </div>
        ) : null}
        <div>
          <Button
            size="sm"
            onClick={() => void saveToolAccess()}
            disabled={!canManage || isSaving}
          >
            {isSaving ? 'Saving tool access…' : 'Save tool access'}
          </Button>
        </div>
      </Stack>
    </section>
  );
}
