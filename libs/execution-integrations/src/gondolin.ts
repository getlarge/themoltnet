import type {
  CompiledExecutionPlan,
  ExecutionPlanSnapshot,
} from '@moltnet/execution-plan';
import type {
  AdapterLaunchReport,
  ExecutionAdapter,
} from '@moltnet/runtime-execution';
import type {
  BrokeredHttpSecretBinding,
  SandboxConfig,
  VmConfig,
} from '@themoltnet/sandbox-gondolin';

export type GondolinBrokeredSecret = Omit<BrokeredHttpSecretBinding, 'value'>;

export type GondolinPlanProjection =
  | {
      rejected: false;
      sandboxConfig: SandboxConfig;
      brokeredSecrets: readonly GondolinBrokeredSecret[];
    }
  | { rejected: true; reasons: readonly string[] };

/** Project an eligible plan without widening exact destination tuples. */
export function projectExecutionPlanToGondolin(
  plan: CompiledExecutionPlan,
): GondolinPlanProjection {
  if (!plan.launchable) {
    return {
      rejected: true,
      reasons: plan.decisions
        .filter(
          (decision) =>
            decision.state !== 'enforced' && decision.state !== 'degraded',
        )
        .map((decision) => decision.reason ?? decision.state),
    };
  }
  const brokeredSecrets: GondolinBrokeredSecret[] = [];
  const reasons: string[] = [];
  for (const deliverable of plan.deliverables) {
    if (deliverable.projection !== 'brokered-http' || !deliverable.guestEnv) {
      reasons.push(`${deliverable.name}: projection_unrepresentable`);
      continue;
    }
    const protocols = [
      ...new Set(deliverable.destinations.map(({ protocol }) => protocol)),
    ];
    const hosts = [
      ...new Set(deliverable.destinations.map(({ host }) => host)),
    ];
    const ports = [
      ...new Set(deliverable.destinations.map(({ port }) => port)),
    ];
    const tuples = new Set(deliverable.destinations.map(destinationTuple));
    const product = new Set<string>();
    for (const protocol of protocols) {
      for (const host of hosts) {
        for (const port of ports) {
          product.add(`${protocol}\u0000${host}\u0000${port}`);
        }
      }
    }
    if (
      protocols.length !== 1 ||
      tuples.size !== deliverable.destinations.length ||
      product.size !== tuples.size ||
      [...product].some((tuple) => !tuples.has(tuple))
    ) {
      reasons.push(`${deliverable.name}: destination_product_unrepresentable`);
      continue;
    }
    brokeredSecrets.push({
      id: deliverable.name,
      guestEnv: deliverable.guestEnv,
      hosts,
      protocol: protocols[0],
      ports,
      required: deliverable.required,
    });
  }
  if (reasons.length > 0) return { rejected: true, reasons };
  return {
    rejected: false,
    sandboxConfig: {
      network: {
        allowedHosts: [...plan.effectiveNetwork.allowedHosts],
        allowedInternalHosts: [...plan.effectiveNetwork.allowedInternalHosts],
      },
    },
    brokeredSecrets,
  };
}

export interface GondolinLaunchInput extends Pick<
  VmConfig,
  'sandboxConfig' | 'brokeredSecrets'
> {
  snapshot: ExecutionPlanSnapshot;
}

export function createGondolinExecutionAdapter(options: {
  identity: ExecutionAdapter['identity'];
  launch(input: GondolinLaunchInput): Promise<AdapterLaunchReport>;
}): ExecutionAdapter {
  return {
    name: 'gondolin',
    identity: options.identity,
    async launch(request) {
      const projection = projectExecutionPlanToGondolin(request.snapshot.plan);
      if (projection.rejected) {
        throw new Error(
          `execution plan cannot be represented: ${projection.reasons.join(', ')}`,
        );
      }
      const brokeredSecrets: BrokeredHttpSecretBinding[] = [];
      for (const secret of projection.brokeredSecrets) {
        let received = false;
        await request.deliverCredential(secret.id, (value) => {
          brokeredSecrets.push({ ...secret, value });
          received = true;
        });
        if (!received) {
          throw new Error(`credential "${secret.id}" yielded no value`);
        }
      }
      return options.launch({
        snapshot: request.snapshot,
        sandboxConfig: projection.sandboxConfig,
        brokeredSecrets,
      });
    },
  };
}

function destinationTuple(destination: {
  protocol: string;
  host: string;
  port: number;
}): string {
  return `${destination.protocol}\u0000${destination.host}\u0000${destination.port}`;
}
