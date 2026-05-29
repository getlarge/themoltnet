import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  createDiary,
  createTask,
  createTeam,
  createTeamInvite,
} from '@moltnet/api-client';
import { test } from '@playwright/test';

import {
  CONSOLE_URL,
  createNativeSessionToken,
  createTestUser,
  createTokenSessionApiClient,
  registerViaBrowser,
  submitKratosForm,
  waitForVerificationData,
} from './helpers/index.js';

// Step 1 of the real-screenshot flow: a human creates a SHARED team + diary,
// seeds several fulfill_brief tasks, and mints a member invite for the agent.
// Outputs the team id, invite code, and the human session token to
// /tmp/landing-shots.json so the shell can join the agent + run the daemon,
// and the capture spec can log the human back in.

const STATE_FILE = join(tmpdir(), 'landing-shots.json');

const BRIEFS = [
  {
    title: 'Add a hello demo file on a feature branch',
    brief:
      "Create a feature branch named feat/smoke-hello, write /workspace/demo/out/hello.txt with the single line 'hi from the foundry', commit the file with a signed diary entry per the runtime instructor, and report the branch name and commit sha in the final FulfillBriefOutput JSON. There is no remote to push to — leave pullRequestUrl null.",
  },
  {
    title: 'Add a README badge for the build status',
    brief:
      'Create a feature branch named feat/readme-badge, add a build-status badge line to the top of /workspace/demo/README.md, commit with a signed diary entry, and report branch + commit sha in the final FulfillBriefOutput JSON. No remote — leave pullRequestUrl null.',
  },
  {
    title: 'Write a CONTRIBUTING note',
    brief:
      "Create a feature branch named feat/contributing, write /workspace/demo/CONTRIBUTING.md with a short 'how to run tests' section, commit with a signed diary entry, and report branch + commit sha in the final FulfillBriefOutput JSON. No remote — leave pullRequestUrl null.",
  },
  {
    title: 'Add a .editorconfig',
    brief:
      'Create a feature branch named feat/editorconfig, write /workspace/demo/.editorconfig with 2-space indent defaults, commit with a signed diary entry, and report branch + commit sha in the final FulfillBriefOutput JSON. No remote — leave pullRequestUrl null.',
  },
];

test('seed shared team, diary, tasks, and agent invite', async ({ page }) => {
  const user = createTestUser({ prefix: 'foundry' });
  const nonce = randomBytes(3).toString('hex');

  await registerViaBrowser(page, user);
  const codeInput = page.locator('input[name="code"]');
  if (await codeInput.isVisible({ timeout: 2000 }).catch(() => false)) {
    const verification = await waitForVerificationData(user.email);
    if (!verification.code) throw new Error('No verification code');
    await codeInput.fill(verification.code);
    await submitKratosForm(page);
  }
  await page.goto(CONSOLE_URL);

  const sessionToken = await createNativeSessionToken(user);
  const client = createTokenSessionApiClient(sessionToken);

  // Shared (non-personal) team so the agent can be invited in.
  const team = await createTeam({
    client,
    body: { name: `the-foundry-${nonce}` },
  });
  if (!team.data) throw new Error(`createTeam failed: ${team.response.status}`);
  const teamId = team.data.id;

  const diary = await createDiary({
    client,
    headers: { 'x-moltnet-team-id': teamId },
    body: { name: `foundry-diary-${nonce}`, visibility: 'private' },
  });
  if (!diary.data) {
    throw new Error(`createDiary failed: ${diary.response.status}`);
  }
  const diaryId = diary.data.id;

  for (const { title, brief } of BRIEFS) {
    const result = await createTask({
      client,
      body: {
        teamId,
        diaryId,
        taskType: 'fulfill_brief',
        maxAttempts: 1,
        input: { brief, title, scopeHint: 'demo' },
      },
    });
    if (!result.data) {
      throw new Error(
        `createTask "${title}" failed: ${result.response.status}`,
      );
    }
  }

  const invite = await createTeamInvite({
    client,
    path: { id: teamId },
    body: { role: 'member' },
  });
  if (!invite.data) {
    throw new Error(`createTeamInvite failed: ${invite.response.status}`);
  }

  writeFileSync(
    STATE_FILE,
    JSON.stringify(
      {
        email: user.email,
        password: user.password,
        sessionToken,
        teamId,
        diaryId,
        inviteCode: invite.data.code,
      },
      null,
      2,
    ),
  );
  // eslint-disable-next-line no-console
  console.log(
    `LANDING_SHOTS team=${teamId} invite=${invite.data.code} state=${STATE_FILE}`,
  );
});
