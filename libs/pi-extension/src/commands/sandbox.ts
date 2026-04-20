import type { CommandRegistrar } from './types.js';

const GUEST_WORKSPACE = '/workspace';

export const registerSandboxCommand: CommandRegistrar = (pi, state) => {
  pi.registerCommand('sandbox', {
    description: 'Show sandbox status and egress policy',
    handler: async (_args, ctx) => {
      if (!state.vm) {
        ctx.ui.notify('Sandbox is not running', 'warning');
        return;
      }
      const r = await state.vm.exec(
        'hostname && echo "---" && df -h / && echo "---" && node --version && pnpm --version && git --version',
      );
      ctx.ui.notify(
        [
          'Sandbox: running',
          `Workspace: ${state.worktreePath ?? state.localCwd} → ${GUEST_WORKSPACE}`,
          `MoltNet diary: ${state.diaryId ?? 'not configured'}`,
          r.stdout?.trimEnd() ?? '',
        ].join('\n'),
        'info',
      );
    },
  });
};
