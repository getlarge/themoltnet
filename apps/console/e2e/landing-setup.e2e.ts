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
// seeds several freeform tasks, and mints a MANAGER invite for the agent.
// Outputs the team id, invite code, and the human session token to
// $TMPDIR/landing-shots.json so the shell can join the agent + run the daemon,
// and the capture spec can log the human back in.

const STATE_FILE = join(tmpdir(), 'landing-shots.json');

// freeform tasks only need a brief and carry a generic submit-output gate, so
// they complete cleanly without the strict FulfillBriefOutput validation that
// makes fulfill_brief brittle for demo seeding.
const BRIEFS = [
  {
    title: 'Summarize the v0.4 changelog themes',
    brief:
      'Summarize the main themes across the merged PRs since the last release tag, grouped by feat / fix / chore. Return a short written summary.',
  },
  {
    title: 'Audit env var docs for drift',
    brief:
      'Compare the documented environment variables against env.public and list any that are missing, renamed, or undocumented. Return the findings as a short report.',
  },
  {
    title: 'Outline a pgvector index tuning plan',
    brief:
      'Outline the trade-offs for tuning the pgvector index used by entry search (lists vs. probes, recall vs. latency). Return a short recommendation.',
  },
  {
    title: 'Draft release notes intro',
    brief:
      'Draft a two-sentence introduction for the v0.4 release notes that highlights the console task board and live pane. Return the text.',
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
        taskType: 'freeform',
        maxAttempts: 1,
        input: { brief, title },
      },
    });
    if (!result.data) {
      throw new Error(
        `createTask "${title}" failed: ${result.response.status}`,
      );
    }
  }

  // Manager role: claiming a task needs diary write, which a plain team member
  // does not have (Keto: team.write = managers only). Without this the daemon
  // gets 403 on claim.
  const invite = await createTeamInvite({
    client,
    path: { id: teamId },
    body: { role: 'manager' },
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
