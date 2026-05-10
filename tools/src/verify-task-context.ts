/**
 * Empirical smoke test for #943 Slice 1.5 context-injection wiring.
 *
 * Boots a Gondolin VM the same way `executePiTask` does, calls
 * `injectTaskContext` against a hand-built TaskContext (one entry per
 * binding kind), and verifies each binding empirically WITHOUT making
 * an LLM API call:
 *
 *   - skill         → `cat` the in-VM SKILL.md from inside the VM and
 *                     compare bytes to what we wrote, AND build pi's
 *                     resource loader with the synthetic Skill and
 *                     confirm `formatSkillsForPrompt` renders it.
 *   - prompt_prefix → assert `injectedContext.systemPromptPrefix`
 *                     contains the marker.
 *   - user_inline   → assert `injectedContext.userInlineSuffix`
 *                     contains the marker.
 *
 * Run from the worktree with a bootstrapped local agent:
 *
 *   pnpm exec tsx tools/src/verify-task-context.ts --agent local-dev
 */
import { parseArgs } from 'node:util';

import { formatSkillsForPrompt } from '@earendil-works/pi-coding-agent';
import {
  ensureSnapshot,
  injectTaskContext,
  resumeVm,
} from '@themoltnet/pi-extension';

const { values: args } = parseArgs({
  options: {
    agent: { type: 'string', short: 'a', default: 'local-dev' },
  },
});

const agentName = args.agent!;

const SKILL_BODY = [
  '---',
  'name: verify-skill',
  'description: Smoke test for Slice 1.5 (#943) context-injection wiring.',
  '---',
  'SKILL-BODY-FIRST-LINE: this is the first non-frontmatter line of the verify-skill body.',
  '',
  'Filler.',
].join('\n');

const PROMPT_PREFIX_MARKER =
  'PROMPT-PREFIX-MARKER: this line was injected via binding=prompt_prefix.';

const USER_INLINE_MARKER =
  'USER-INLINE-MARKER: this line was injected via binding=user_inline.';

const CONTEXT = [
  { slug: 'verify-skill', binding: 'skill' as const, content: SKILL_BODY },
  {
    slug: 'verify-prompt-prefix',
    binding: 'prompt_prefix' as const,
    content: PROMPT_PREFIX_MARKER,
  },
  {
    slug: 'verify-user-inline',
    binding: 'user_inline' as const,
    content: USER_INLINE_MARKER,
  },
];

const PASS = '✓';
const FAIL = '✗';

interface CheckResult {
  name: string;
  ok: boolean;
  detail: string;
}

async function main() {
  const checks: CheckResult[] = [];
  const record = (name: string, ok: boolean, detail: string) => {
    checks.push({ name, ok, detail });
    process.stdout.write(`${ok ? PASS : FAIL} ${name}\n  ${detail}\n`);
  };

  process.stderr.write('[verify] booting Gondolin VM…\n');
  const checkpointPath = await ensureSnapshot({
    onProgress: (m) => process.stderr.write(`[snapshot] ${m}\n`),
  });
  const managed = await resumeVm({
    checkpointPath,
    agentName,
    mountPath: process.cwd(),
  });

  try {
    process.stderr.write('[verify] running injectTaskContext…\n');
    const injected = await injectTaskContext({
      context: CONTEXT,
      fs: managed.vm.fs,
    });

    // --- prompt_prefix
    record(
      'systemPromptPrefix carries the prompt_prefix marker',
      injected.systemPromptPrefix.includes(PROMPT_PREFIX_MARKER),
      `len=${injected.systemPromptPrefix.length}; head=${JSON.stringify(injected.systemPromptPrefix.slice(0, 80))}`,
    );

    // --- user_inline
    record(
      'userInlineSuffix carries the user_inline marker',
      injected.userInlineSuffix.includes(USER_INLINE_MARKER),
      `len=${injected.userInlineSuffix.length}; head=${JSON.stringify(injected.userInlineSuffix.slice(0, 80))}`,
    );

    // --- skill: synthetic Skill object shape
    const skill = injected.skills[0];
    record(
      'one synthetic Skill emitted',
      injected.skills.length === 1,
      `count=${injected.skills.length}`,
    );
    if (skill) {
      record(
        'synthetic Skill name parsed from frontmatter',
        skill.name === 'verify-skill',
        `name=${JSON.stringify(skill.name)}`,
      );
      record(
        'synthetic Skill filePath points at the in-VM mount',
        skill.filePath === '/moltnet-task-skills/verify-skill/SKILL.md',
        `filePath=${JSON.stringify(skill.filePath)}`,
      );
    }

    // --- skill: file is reachable from inside the VM via vm.exec
    process.stderr.write('[verify] cat inside VM…\n');
    const catRes = await managed.vm.exec([
      '/bin/cat',
      '/moltnet-task-skills/verify-skill/SKILL.md',
    ]);
    record(
      'in-VM `cat` reads the SKILL.md without error',
      catRes.ok,
      `ok=${catRes.ok}, exitCode=${catRes.exitCode}, stderr=${JSON.stringify(catRes.stderr.slice(0, 120))}`,
    );
    const catBody = catRes.stdoutBuffer.toString('utf8');
    record(
      'in-VM SKILL.md bytes match what we wrote',
      catBody === SKILL_BODY,
      `wrote=${SKILL_BODY.length}B, read=${catBody.length}B, equal=${catBody === SKILL_BODY}`,
    );

    // --- skill: pi's formatSkillsForPrompt renders it
    const rendered = formatSkillsForPrompt(injected.skills);
    record(
      'pi formatSkillsForPrompt includes our synthetic Skill',
      rendered.includes('verify-skill') &&
        rendered.includes('/moltnet-task-skills/verify-skill/SKILL.md'),
      `len=${rendered.length}; contains-name=${rendered.includes('verify-skill')}, contains-location=${rendered.includes('/moltnet-task-skills/verify-skill/SKILL.md')}`,
    );
  } finally {
    process.stderr.write('[verify] closing VM…\n');
    await managed.vm.close();
  }

  // Summary
  const failed = checks.filter((c) => !c.ok);
  process.stdout.write(
    `\n${checks.length - failed.length}/${checks.length} checks passed\n`,
  );
  if (failed.length > 0) {
    process.stdout.write(`\nFailures:\n`);
    for (const c of failed) {
      process.stdout.write(`  ${FAIL} ${c.name}\n      ${c.detail}\n`);
    }
    process.exit(1);
  }
}

main().catch((err) => {
  process.stderr.write(
    `[fatal] ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`,
  );
  process.exit(2);
});
