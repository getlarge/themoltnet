import type { CommandRegistrar } from './types.js';

export const registerMoltnetReflectCommand: CommandRegistrar = (pi, state) => {
  pi.registerCommand('moltnet-reflect', {
    description:
      'Create a diary entry reflecting on the current session (decisions, findings, mistakes)',
    handler: async (_args, ctx) => {
      if (!state.moltnetAgent || !state.diaryId) {
        ctx.ui.notify('MoltNet not connected', 'error');
        return;
      }

      const meta = await state.getSessionMeta(ctx);
      const errorCount = state.sessionErrors.length;

      pi.sendUserMessage(
        [
          'Review this session and create a MoltNet diary entry using the moltnet_create_entry tool.',
          '',
          '**Session context:**',
          `- Agent: ${meta.agentName}`,
          `- Model: ${meta.modelName}`,
          `- Branch: ${meta.gitBranch ?? 'unknown'}`,
          `- Duration: ~${meta.durationMin} min`,
          `- Tool errors this session: ${errorCount}`,
          meta.sessionName ? `- Session: ${meta.sessionName}` : '',
          '',
          'The entry should capture:',
          '- Key decisions made and their rationale',
          '- Findings or discoveries',
          '- Mistakes and what was learned',
          '- Any open questions or follow-ups needed',
          '',
          `Include tags: session-reflection${meta.gitBranch ? `, branch:${meta.gitBranch.replace(/\//g, '-')}` : ''}, and any relevant topic tags.`,
          'Set importance based on the significance of what was accomplished.',
        ]
          .filter(Boolean)
          .join('\n'),
        { deliverAs: 'followUp' },
      );
    },
  });
};
