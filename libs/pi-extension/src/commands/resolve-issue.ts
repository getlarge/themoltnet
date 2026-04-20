import { execFileSync } from 'node:child_process';

import type { CommandRegistrar } from './types.js';

const GUEST_WORKSPACE = '/workspace';

export const registerResolveIssueCommand: CommandRegistrar = (pi, state) => {
  pi.registerCommand('resolve-issue', {
    description:
      'Pick up a GitHub issue and resolve it with accountable commits and a PR',
    handler: async (args, ctx) => {
      const issueRef = args.trim();
      if (!issueRef) {
        ctx.ui.notify('Usage: /resolve-issue <number|url>', 'error');
        return;
      }

      await state.ensureVm(ctx);

      // Fetch issue content on the host using the agent's GH token
      let issueBody: string;
      try {
        const ghToken = state.getAgentGhToken();
        if (!ghToken) {
          ctx.ui.notify(
            'Agent GH token unavailable — refusing to fall back to human auth. Check moltnet.json.',
            'error',
          );
          return;
        }
        const ghArgs = [
          'issue',
          'view',
          issueRef,
          '--json',
          'number,title,body,labels,assignees,comments',
        ];
        issueBody = execFileSync('gh', ghArgs, {
          encoding: 'utf8',
          cwd: state.worktreePath ?? state.localCwd,
          env: { ...process.env, GH_TOKEN: ghToken },
          stdio: ['pipe', 'pipe', 'pipe'],
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        ctx.ui.notify(`Failed to fetch issue: ${msg}`, 'error');
        return;
      }

      const issue = JSON.parse(issueBody) as {
        number: number;
        title: string;
        body: string;
        labels: { name: string }[];
        comments: { body: string; author: { login: string } }[];
      };

      const meta = await state.getSessionMeta(ctx);
      const labelList = issue.labels.map((l) => l.name).join(', ');
      const commentSummary = issue.comments
        .slice(-5)
        .map((c) => `**${c.author.login}**: ${c.body.slice(0, 300)}`)
        .join('\n\n');

      pi.sendUserMessage(
        [
          `**IMPORTANT**: Before doing anything else, read the file \`/workspace/.agents/skills/legreffier/SKILL.md\` and follow its workflow for all commits in this session. Every commit must have a diary entry.`,
          '',
          `## Task: Resolve Issue #${issue.number}`,
          '',
          `**Title:** ${issue.title}`,
          labelList ? `**Labels:** ${labelList}` : '',
          '',
          '### Issue Description',
          '',
          issue.body ?? '_No description provided._',
          '',
          commentSummary ? `### Recent Comments\n\n${commentSummary}` : '',
          '',
          '### Instructions',
          '',
          `1. Create a feature branch: \`git checkout -b fix/${issue.number}-<slug>\``,
          '2. Understand the problem — read relevant code, reproduce if possible',
          '3. Implement the fix or feature',
          '4. Write tests if applicable',
          '5. Follow the legreffier accountable commit workflow for every commit (diary entry + signed commit)',
          `6. Push the branch and create a PR referencing issue #${issue.number}`,
          '',
          '### Context',
          '',
          `- Agent: ${meta.agentName}`,
          `- Diary: ${state.diaryId ?? 'unknown'}`,
          `- Branch: ${meta.gitBranch ?? 'main'}`,
          `- Workspace: ${GUEST_WORKSPACE}`,
        ]
          .filter(Boolean)
          .join('\n'),
        { deliverAs: 'followUp' },
      );
    },
  });
};
