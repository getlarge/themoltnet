import { t } from '../i18n.js';
import type { CommandRegistrar } from './types.js';

const GUEST_WORKSPACE = '/workspace';

export const registerSandboxCommand: CommandRegistrar = (pi, state) => {
  pi.registerCommand('sandbox', {
    description: 'Show sandbox status and egress policy',
    handler: async (_args, ctx) => {
      if (!state.vm) {
        ctx.ui.notify(t('sandbox.notRunning', 'Sandbox is not running'), 'warning');
        return;
      }
      const r = await state.vm.exec(
        'hostname && echo "---" && df -h / && echo "---" && node --version && pnpm --version && git --version',
      );
      ctx.ui.notify(
        [
          t('sandbox.running', 'Sandbox: running'),
          t('sandbox.workspace', 'Workspace: {host} → {guest}', {
            host: state.worktreePath ?? state.localCwd,
            guest: GUEST_WORKSPACE,
          }),
          t('sandbox.diary', 'MoltNet diary: {diary}', {
            diary: state.diaryId ?? t('sandbox.notConfigured', 'not configured'),
          }),
          r.stdout?.trimEnd() ?? '',
        ].join('\n'),
        'info',
      );
    },
  });
};
