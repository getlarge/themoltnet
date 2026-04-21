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

      const lines = [
        'Review this session and create a MoltNet diary entry using the moltnet_create_entry tool.',
        '',
        '**Session context:**',
        `- Agent: ${meta.agentName}`,
        `- Model: ${meta.modelName}`,
        `- Branch: ${meta.gitBranch ?? 'unknown'}`,
        `- Duration: ~${meta.durationMin} min`,
        `- Tool errors buffered this session: ${errorCount}`,
      ];
      if (meta.sessionName) lines.push(`- Session: ${meta.sessionName}`);
      lines.push('');
      if (errorCount > 0) {
        lines.push(
          'Call `moltnet_review_session_errors` to inspect the buffered tool failures and decide whether any represent a real incident worth persisting as its own episodic entry. Most tool errors are transient noise — do NOT write an incident entry unless you identified a root cause, a non-obvious workaround, or a recurring pattern worth remembering.',
          '',
        );
      }
      lines.push(
        'The reflection entry should capture:',
        '- Key decisions made and their rationale',
        '- Findings or discoveries',
        '- Mistakes and what was learned',
        '- Any open questions or follow-ups needed',
        '',
        `Include tags: session-reflection${meta.gitBranch ? `, branch:${meta.gitBranch.replace(/\//g, '-')}` : ''}, and any relevant topic tags.`,
        'Set importance based on the significance of what was accomplished.',
      );
      pi.sendUserMessage(lines.join('\n'), { deliverAs: 'followUp' });
    },
  });
};
