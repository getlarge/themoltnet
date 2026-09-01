/**
 * Live proof that a portable plan crosses the Gondolin integration boundary
 * and drives the production resumeVm path without widening or leaking values.
 * Opt in with MOLTNET_PI_VM_INTEGRATION=1 (the CI VM lane does this).
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  compileExecutionPlan,
  createExecutionPlanSnapshot,
  credentialAuthorityControl,
  credentialProjectionControl,
  type ExecutionIntent,
  parseCredentialRequirements,
} from '@moltnet/execution-plan';
import {
  bindExecution,
  createRuntimeExecution,
} from '@moltnet/runtime-execution';
import {
  ensureSnapshot,
  execManagedCommand,
  resumeVm,
  type VmDiagnostic,
} from '@themoltnet/sandbox-gondolin';
import {
  READ_ONLY_CAPABILITIES,
  SecretProviderRegistry,
} from '@themoltnet/sdk';
import { afterAll, describe, expect, it } from 'vitest';

import {
  checkCredentialReadiness,
  createCredentialDeliveryPort,
} from './credential-broker.js';
import { createGondolinExecutionAdapter } from './gondolin.js';

const describeIntegration =
  process.env.MOLTNET_PI_VM_INTEGRATION === '1' ? describe : describe.skip;

const ALLOWED_ORIGIN = 'https://allowed.moltnet.internal';
const DENIED_ORIGIN = 'https://denied.moltnet.internal';
const SENTINEL = 'synthetic-sentinel-2004';
const BINDING_KEY = 'fixture-api-key';
const EXECUTOR = {
  id: 'gondolin-live-fixture',
  fingerprint: 'sha256:gondolin-live-fixture',
};

describeIntegration('governed Gondolin execution integration', () => {
  const cleanups: (() => Promise<void>)[] = [];
  afterAll(async () => {
    for (const cleanup of cleanups.reverse()) await cleanup();
  });

  it(
    'delivers only to the exact allowed origin with value-free evidence',
    { timeout: 600_000 },
    async () => {
      const allowedAuth: (string | null)[] = [];
      const deniedAuth: (string | null)[] = [];
      const diagnostics: VmDiagnostic[] = [];
      let scopedValueRegistered = false;

      const requirements = parseCredentialRequirements([
        {
          name: 'fixture-api',
          kind: 'http-bearer',
          projection: 'brokered-http',
          guestEnv: 'FIXTURE_API_TOKEN',
          destinations: [
            {
              protocol: 'https',
              host: 'allowed.moltnet.internal',
              port: 443,
            },
          ],
        },
      ]);
      const bindings = {
        'fixture-api': {
          reference: { provider: 'fixture', key: BINDING_KEY },
          source: 'vm-integration-fixture',
        },
      };
      const providers = new SecretProviderRegistry().register({
        name: 'fixture',
        capabilities: READ_ONLY_CAPABILITIES,
        read: (key) => Promise.resolve(key === BINDING_KEY ? SENTINEL : null),
        probe: (key) =>
          Promise.resolve(key === BINDING_KEY ? 'present' : 'absent'),
      });
      const credentialReadiness = await checkCredentialReadiness(
        requirements,
        bindings,
        providers,
      );
      const intent: ExecutionIntent = {
        mode: 'enforce',
        profile: {
          id: 'profile-integration',
          revision: 1,
          definitionCid: 'bafyintegration',
        },
        authority: {
          policySnapshotHash: 'sha256:integration',
          policySnapshotVersion: 'effective-policy:v1',
          authorizedControls: [credentialAuthorityControl('fixture-api')],
        },
        credentialRequirements: requirements,
        requiredCapabilities: [],
        lease: { ttlSec: 600, requiredControls: [] },
        network: {
          allowedHosts: [],
          allowedInternalHosts: [
            'allowed.moltnet.internal',
            'denied.moltnet.internal',
          ],
        },
      };
      const offer = {
        executor: EXECUTOR,
        controls: [
          {
            id: credentialProjectionControl('brokered-http'),
            enforcement: 'native' as const,
            locus: 'gondolin:host-http-hooks',
            constraints: {
              destinations: requirements[0].destinations,
              guestEnvs: ['FIXTURE_API_TOKEN'],
            },
          },
        ],
      };
      const plan = compileExecutionPlan({
        intent,
        offer,
        credentialReadiness,
      });
      const snapshot = await createExecutionPlanSnapshot({
        intent,
        offer,
        credentialReadiness,
        plan,
      });
      const execution = await createRuntimeExecution(snapshot, {
        executionId: 'exec-integration-1',
      });
      const workspace = await mkdtemp(
        path.join(tmpdir(), 'moltnet-execution-integration-'),
      );
      const agentRoot = await mkdtemp(
        path.join(tmpdir(), 'moltnet-execution-root-'),
      );
      cleanups.push(async () => {
        await rm(workspace, { recursive: true, force: true });
        await rm(agentRoot, { recursive: true, force: true });
      });

      const adapter = createGondolinExecutionAdapter({
        identity: EXECUTOR,
        async launch(input) {
          // Raw values are observable only inside this trusted, scoped launch
          // callback. Gondolin's host-origin callback intentionally receives
          // the opaque guest placeholder before secret substitution.
          scopedValueRegistered =
            input.brokeredSecrets?.[0]?.value === SENTINEL;
          const checkpointPath = await ensureSnapshot();
          const managed = await resumeVm({
            checkpointPath,
            agentName: 'configless',
            agentRootDir: agentRoot,
            mountPath: workspace,
            sandboxConfig: input.sandboxConfig,
            brokeredSecrets: input.brokeredSecrets,
            hostOrigins: {
              [ALLOWED_ORIGIN]: (request) => {
                allowedAuth.push(request.headers.get('authorization'));
                return Promise.resolve(new Response('accepted'));
              },
              [DENIED_ORIGIN]: (request) => {
                deniedAuth.push(request.headers.get('authorization'));
                return Promise.resolve(
                  new Response('denied-endpoint', { status: 403 }),
                );
              },
            },
            onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
          });
          cleanups.push(() => managed.vm.close());
          const chunks: string[] = [];
          const result = await execManagedCommand(
            managed.vm,
            `
set -eu
case "$FIXTURE_API_TOKEN" in
  GONDOLIN_SECRET_*) ;;
  *) echo invalid-placeholder; exit 1 ;;
esac
curl -fsS --max-time 20 \\
  -H "Authorization: Bearer $FIXTURE_API_TOKEN" \\
  ${ALLOWED_ORIGIN}/authorized
if curl -fsS --max-time 10 \\
  -H "Authorization: Bearer $FIXTURE_API_TOKEN" \\
  ${DENIED_ORIGIN}/denied >/dev/null 2>&1; then
  echo wrong-destination-delivered
  exit 1
fi
echo governed-exec-done
`,
            {
              timeoutMs: 120_000,
              onData: (data) => chunks.push(data.toString()),
            },
          );
          if (
            result.exitCode !== 0 ||
            !chunks.join('').includes('governed-exec-done')
          ) {
            return {
              controls: [
                {
                  control: 'credential:fixture-api',
                  state: 'failed' as const,
                  reason: 'guest_command_failed',
                },
              ],
            };
          }
          return {
            controls: [
              {
                control: 'network-egress:fixture-api',
                state: 'enforced' as const,
                basis: 'verified' as const,
                locus: 'gondolin:host-http-hooks',
                reason: 'allowed_origin_oracle',
              },
            ],
          };
        },
      });
      const evidence = await bindExecution(
        execution,
        adapter,
        createCredentialDeliveryPort(bindings, providers),
      );

      expect(scopedValueRegistered).toBe(true);
      expect(allowedAuth).toHaveLength(1);
      expect(allowedAuth[0]).toMatch(/^Bearer GONDOLIN_SECRET_/);
      expect(allowedAuth).not.toContain(`Bearer ${SENTINEL}`);
      // Host-origin fixtures run before Gondolin's outbound substitution.
      // Even the denied path can observe the placeholder, but never the value;
      // the origin policy then rejects the request before any network delivery.
      expect(deniedAuth).toHaveLength(1);
      expect(deniedAuth[0]).toMatch(/^Bearer GONDOLIN_SECRET_/);
      expect(deniedAuth).not.toContain(`Bearer ${SENTINEL}`);
      expect(diagnostics).toContainEqual(
        expect.objectContaining({
          event: 'vm.http_secrets.bound',
          brokeredSecretCount: 1,
        }),
      );
      const persisted = JSON.stringify({
        snapshot,
        evidence,
        diagnostics,
        allowedAuth,
        deniedAuth,
      });
      expect(persisted).not.toContain(SENTINEL);
      expect(persisted).not.toContain(BINDING_KEY);
      expect(evidence).toContainEqual(
        expect.objectContaining({
          control: 'credential:fixture-api',
          adapter: 'gondolin',
          state: 'enforced',
          basis: 'applied',
          reportedBy: 'host',
          bindingSource: 'vm-integration-fixture',
          executionId: 'exec-integration-1',
          snapshotCid: snapshot.cid,
        }),
      );
      expect(evidence).toContainEqual(
        expect.objectContaining({
          control: 'network-egress:fixture-api',
          state: 'enforced',
          basis: 'verified',
          reportedBy: 'adapter',
          reason: 'allowed_origin_oracle',
        }),
      );
    },
  );
});
