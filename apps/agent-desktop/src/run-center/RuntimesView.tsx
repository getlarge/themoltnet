import {
  Badge,
  Button,
  ConfirmDialog,
  ControlSurface,
  DescriptionList,
  Dialog,
  Divider,
  InlineNotice,
  Input,
  Stack,
  Text,
} from '@themoltnet/design-system';
import { useState } from 'react';

import { relativeTime, shortHash, tildePath } from './format.js';
import type {
  RunCenterActions,
  RunCenterData,
  RuntimeCandidate,
  RuntimeEntry,
} from './types.js';

export interface RuntimesViewProps {
  data: RunCenterData;
  actions: RunCenterActions;
  now: number;
}

const DRIFT_COPY: Record<
  Exclude<RuntimeEntry['drift'], 'none'>,
  { title: string; body: string }
> = {
  entry_changed: {
    title: 'The module changed since you registered it',
    body: 'Runs that need this kind refuse to start. Review the change, then register it again to pin the new fingerprint.',
  },
  lockfile_changed: {
    title: 'The project lockfile changed since you registered it',
    body: 'The package may now resolve to different code. Register it again to pin the new state.',
  },
  missing: {
    title: 'The module is no longer at the registered path',
    body: 'Runs that need this kind refuse to start. Point the registration at the current file, or remove it.',
  },
};

export function RuntimesView({ data, actions, now }: RuntimesViewProps) {
  const [candidate, setCandidate] = useState<RuntimeCandidate | null>(null);
  const [packageForm, setPackageForm] = useState<{
    name: string;
    dir: string;
  } | null>(null);
  const [unregisterKind, setUnregisterKind] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const drifted = data.runtimes.filter((runtime) => runtime.drift !== 'none');

  const pickFile = async () => {
    setBusy(true);
    try {
      const picked = await actions.pickRuntimeFile();
      if (picked) setCandidate(picked);
    } finally {
      setBusy(false);
    }
  };

  const validatePackage = async () => {
    if (!packageForm) return;
    setBusy(true);
    try {
      const picked = await actions.pickRuntimePackage(
        packageForm.name.trim(),
        packageForm.dir.trim(),
      );
      setPackageForm(null);
      setCandidate(picked);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Stack gap={6}>
      <Stack gap={1}>
        <Text as="h1" variant="h4">
          Runtimes
        </Text>
        <Text variant="caption" color="secondary">
          The adapter that executes a task. Every profile names one kind, and a
          run refuses to start if this machine cannot produce it.
        </Text>
      </Stack>

      {data.capabilities.supportsCustomRuntimes ? (
        <InlineNotice
          tone="warning"
          title="Custom runtimes run outside the agent sandbox"
        >
          A registered module executes on this Mac with your permissions, before
          any profile policy applies. Register only code you wrote or audited.
        </InlineNotice>
      ) : null}

      {drifted.length ? (
        <InlineNotice
          tone="error"
          title={`${drifted.length} registration${drifted.length === 1 ? '' : 's'} no longer match`}
        >
          MoltNet pins a fingerprint when you register a runtime, so code that
          changed underneath you cannot execute silently. Review each one below.
        </InlineNotice>
      ) : null}

      <Stack gap={3}>
        {data.runtimes.map((runtime) => (
          <RuntimeCard
            key={runtime.kind}
            runtime={runtime}
            now={now}
            onUnregister={() => setUnregisterKind(runtime.kind)}
            onReregister={() => {
              if (runtime.source === 'package') {
                setPackageForm({
                  name: runtime.label,
                  dir: runtime.projectDir ?? '',
                });
              } else {
                void pickFile();
              }
            }}
          />
        ))}
      </Stack>

      <Stack direction="row" gap={3} wrap>
        <Button
          variant="secondary"
          size="sm"
          disabled={busy}
          onClick={() => void pickFile()}
        >
          Register a file…
        </Button>
        <Button
          variant="secondary"
          size="sm"
          disabled={busy}
          onClick={() => setPackageForm({ name: '', dir: '' })}
        >
          Register a package…
        </Button>
      </Stack>

      <Text variant="caption" color="muted">
        MoltNet never installs packages. A package must already be installed in
        the project directory you point at.
      </Text>

      <PackageDialog
        form={packageForm}
        busy={busy}
        onChange={setPackageForm}
        onBrowse={async () => {
          const dir = await actions.pickDirectory();
          if (dir && packageForm) setPackageForm({ ...packageForm, dir });
        }}
        onCancel={() => setPackageForm(null)}
        onValidate={() => void validatePackage()}
      />

      <RegisterDialog
        candidate={candidate}
        busy={busy}
        onCancel={() => setCandidate(null)}
        onConfirm={async () => {
          if (!candidate) return;
          setBusy(true);
          try {
            await actions.registerRuntime(candidate);
            setCandidate(null);
          } finally {
            setBusy(false);
          }
        }}
      />

      <ConfirmDialog
        open={unregisterKind !== null}
        title={`Remove the ${unregisterKind ?? ''} runtime?`}
        message="The module stays on disk; MoltNet stops allowing it to execute. Profiles that name this kind will fail to start until you register it again."
        confirmLabel="Remove registration"
        destructive
        onCancel={() => setUnregisterKind(null)}
        onConfirm={() => {
          const kind = unregisterKind;
          setUnregisterKind(null);
          if (kind) void actions.unregisterRuntime(kind);
        }}
      />
    </Stack>
  );
}

function RuntimeCard({
  runtime,
  now,
  onReregister,
  onUnregister,
}: {
  runtime: RuntimeEntry;
  now: number;
  onReregister: () => void;
  onUnregister: () => void;
}) {
  const builtin = runtime.source === 'builtin';
  const drift = runtime.drift === 'none' ? null : DRIFT_COPY[runtime.drift];

  return (
    <ControlSurface
      as="article"
      padding="md"
      style={
        drift ? { borderColor: 'var(--molt-error)' } : undefined
      }
    >
      <Stack gap={4}>
        <Stack direction="row" justify="space-between" align="flex-start" gap={4} wrap>
          <Stack gap={1} style={{ minWidth: 0 }}>
            <Text as="h2" variant="bodyLarge" weight="semibold" mono>
              {runtime.kind}
            </Text>
            <Text variant="caption" color="muted">
              {builtin
                ? 'Bundled with the agent. Always available.'
                : tildePath(runtime.label)}
            </Text>
          </Stack>
          <Stack direction="row" gap={2} align="center">
            {drift ? <Badge variant="error">needs attention</Badge> : null}
            <Badge variant={builtin ? 'default' : 'accent'}>
              {builtin ? 'built in' : runtime.source}
            </Badge>
          </Stack>
        </Stack>

        {drift ? (
          <InlineNotice tone="error" title={drift.title}>
            {drift.body}
          </InlineNotice>
        ) : null}

        {builtin ? null : (
          <DescriptionList
            ariaLabel={`${runtime.kind} registration`}
            columns={3}
            compact
            items={[
              {
                label: 'Fingerprint',
                value: shortHash(runtime.entryHash),
                mono: true,
              },
              {
                label: 'Registered',
                value: relativeTime(runtime.registeredAt, now),
              },
              ...(runtime.projectDir
                ? [
                    {
                      label: 'Project',
                      value: tildePath(runtime.projectDir),
                      mono: true,
                    },
                  ]
                : []),
            ]}
          />
        )}

        <Divider style={{ margin: 0 }} />

        <Stack direction="row" justify="space-between" align="center" gap={4} wrap>
          <Text variant="caption" color="secondary">
            {runtime.usedByProfiles.length
              ? `Used by ${runtime.usedByProfiles.join(', ')}`
              : 'No profile names this kind yet'}
          </Text>
          {builtin ? null : (
            <Stack direction="row" gap={2}>
              <Button variant="secondary" size="sm" onClick={onReregister}>
                {drift ? 'Review and re-register' : 'Re-register'}
              </Button>
              <Button variant="ghost" size="sm" onClick={onUnregister}>
                Remove
              </Button>
            </Stack>
          )}
        </Stack>
      </Stack>
    </ControlSurface>
  );
}

function PackageDialog({
  form,
  busy,
  onChange,
  onBrowse,
  onCancel,
  onValidate,
}: {
  form: { name: string; dir: string } | null;
  busy: boolean;
  onChange: (next: { name: string; dir: string }) => void;
  onBrowse: () => void;
  onCancel: () => void;
  onValidate: () => void;
}) {
  return (
    <Dialog
      open={form !== null}
      onClose={onCancel}
      title="Register an installed package"
      width="34rem"
    >
      <Stack gap={5}>
        <Text variant="caption" color="secondary">
          Point MoltNet at a package that is already installed in a project on
          this Mac. The app never runs a package manager.
        </Text>
        <Input
          label="Package name"
          placeholder="@acme/moltnet-runtime"
          value={form?.name ?? ''}
          onChange={(event) =>
            onChange({ name: event.target.value, dir: form?.dir ?? '' })
          }
        />
        <Stack gap={2}>
          <Input
            label="Project directory"
            placeholder="~/dev/acme-adapter"
            hint="The directory whose node_modules and lockfile the package resolves against."
            value={form ? tildePath(form.dir) : ''}
            readOnly
          />
          <Button
            variant="secondary"
            size="sm"
            onClick={onBrowse}
            style={{ alignSelf: 'flex-start' }}
          >
            Choose directory…
          </Button>
        </Stack>
        <Stack direction="row" justify="flex-end" gap={3}>
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            variant="accent"
            loading={busy}
            loadingLabel="Checking the package"
            disabled={!form?.name.trim() || !form?.dir.trim()}
            onClick={onValidate}
          >
            Check package
          </Button>
        </Stack>
      </Stack>
    </Dialog>
  );
}

/**
 * The consent step. It names the resolved module, the kind derived from that
 * module, and the fingerprint that will be pinned — then says plainly what
 * registering allows.
 */
function RegisterDialog({
  candidate,
  busy,
  onCancel,
  onConfirm,
}: {
  candidate: RuntimeCandidate | null;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const failed = Boolean(candidate?.error);
  return (
    <Dialog
      open={candidate !== null}
      onClose={onCancel}
      title={failed ? 'This module cannot be registered' : 'Register custom runtime?'}
      width="34rem"
    >
      {candidate ? (
        <Stack gap={5}>
          <DescriptionList
            ariaLabel="Runtime module"
            columns={1}
            compact
            items={[
              {
                label: candidate.source === 'file' ? 'File' : 'Package',
                value: tildePath(candidate.label),
                mono: true,
              },
              ...(candidate.projectDir
                ? [
                    {
                      label: 'Project',
                      value: tildePath(candidate.projectDir),
                      mono: true,
                    },
                  ]
                : []),
              ...(candidate.error
                ? []
                : [
                    {
                      label: 'Runtime kind',
                      value: `${candidate.kind}  (declared by the module)`,
                      mono: true,
                    },
                    {
                      label: 'Fingerprint',
                      value: shortHash(candidate.entryHash),
                      mono: true,
                    },
                  ]),
            ]}
          />

          {candidate.error ? (
            <InlineNotice tone="error" title={candidate.error.message}>
              {candidate.error.remedy}
            </InlineNotice>
          ) : (
            <InlineNotice
              tone="warning"
              title="This module runs on your Mac with your permissions"
            >
              It executes outside the agent sandbox, before any runtime profile
              policy applies. Register only code you wrote or audited. MoltNet
              pins the fingerprint above and refuses to run the module if it
              changes.
            </InlineNotice>
          )}

          <Stack direction="row" justify="flex-end" gap={3}>
            <Button variant="secondary" onClick={onCancel}>
              {failed ? 'Close' : 'Cancel'}
            </Button>
            {failed ? null : (
              <Button
                variant="accent"
                loading={busy}
                loadingLabel="Registering runtime"
                onClick={onConfirm}
              >
                Register {candidate.kind}
              </Button>
            )}
          </Stack>
        </Stack>
      ) : null}
    </Dialog>
  );
}
