import {
  type ManagedVm,
  resumeVm as resumeSandboxVm,
  type VmConfig,
} from '@themoltnet/sandbox-gondolin';

/**
 * Resume a Gondolin VM for a Pi session. The Pi coding-agent session and its
 * model calls run host-side (`createAgentSession` reads the host `~/.pi/agent`
 * auth), so the guest carries no provider auth — it only executes Gondolin
 * tools via `vm.exec`. This is a thin pass-through to the sandbox package.
 */
export function resumeVm(config: VmConfig): Promise<ManagedVm> {
  return resumeSandboxVm(config);
}
