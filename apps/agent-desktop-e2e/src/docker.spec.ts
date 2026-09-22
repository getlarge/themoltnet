import type { DesktopStatus } from '@moltnet/agent-desktop/bridge';
import { $, browser, expect } from '@wdio/globals';

import { journeyAgent } from './docker-journey.js';
import { field, lifecycle } from './journey-helpers.js';
import { enableNativePolling, selectNative } from './native-visibility.js';

async function click(selector: string) {
  const element = $(selector);
  await browser.execute(
    (value) =>
      (value as unknown as HTMLElement).scrollIntoView({
        behavior: 'instant',
        block: 'center',
      }),
    await element.getElement(),
  );
  await element.click();
}

type JourneyAgent = Awaited<ReturnType<typeof journeyAgent>>['agent'];

/**
 * A failed task ends the wait with its own error; throwing inside the
 * condition would be retried until the timeout and reported as one.
 */
async function waitForTask(agent: JourneyAgent, id: string, label: string) {
  let failed = false;
  let last = 'unknown';
  await browser.waitUntil(
    async () => {
      last = (await agent.tasks.get(id)).status;
      failed = last === 'failed';
      return failed || last === 'completed';
    },
    {
      timeout: 60000,
      interval: 500,
      timeoutMsg: `${label} did not complete the real API task (last status: ${last})`,
    },
  );
  if (failed) throw new Error(`${label} failed task ${id}`);
}

describe('Personal Desktop journey against Docker services', () => {
  it('manages a location, claims project and General work separately, and persists captured history', async () => {
    const root = process.env.MOLTNET_DESKTOP_E2E_FIXTURE_ROOT;
    if (!root) throw new Error('Use the isolated Docker launcher');
    await enableNativePolling();
    const { agent, journey } = await journeyAgent(root);
    let serverState = 'unknown';
    await browser.waitUntil(
      async () => {
        const state = await browser.tauri.execute<Promise<DesktopStatus>, []>(
          ({ core }) => core.invoke('desktop_status') as Promise<DesktopStatus>,
        );
        serverState = state.state;
        return state.state === 'running';
      },
      {
        timeout: 20000,
        timeoutMsg: `The Agent Server did not start (last state: ${serverState})`,
      },
    );
    try {
      await $('a=Projects').click();
      await expect($('h2=Shared with the team')).toBeDisplayed();
      await expect(field('Project')).toHaveValue(journey.projectId);
      await click('button=Add local location');
      await $(
        '//label[normalize-space()="Location name"]/following-sibling::input',
      ).setValue('Personal work');
      await selectNative(field('Workspace default'), 'none');
      await click('button=Save location');
      await expect($('h3=Personal work')).toBeDisplayed();
      const projectTask = await agent.tasks.create(
        {
          taskType: 'freeform',
          title: 'Desktop project work',
          projectId: journey.projectId,
          diaryId: journey.diaryId,
          input: {
            brief: 'Complete this deterministic project acceptance task.',
          },
        },
        { teamId: journey.teamId },
      );
      const generalTask = await agent.tasks.create(
        {
          taskType: 'freeform',
          title: 'Desktop General work',
          diaryId: journey.diaryId,
          input: {
            brief: 'Complete this deterministic General acceptance task.',
          },
        },
        { teamId: journey.teamId },
      );
      await $('a=Runs').click();
      await click('button=New run');
      await selectNative(field('Project'), journey.projectId);
      await expect(field('Local location')).toHaveValue('Personal work');
      await selectNative(field('Runtime profile'), journey.profileId);
      await click('button=Start run');
      await expect($('button=Stop')).toBeDisplayed();
      await waitForTask(agent, projectTask.id, 'Desktop project worker');
      await click('button=Stop');
      await expect($('button=Stop')).not.toExist({ wait: 20000 });
      // Checked once the project run has stopped polling: it must never have
      // claimed General work, which only the General run below may complete.
      expect((await agent.tasks.get(generalTask.id)).status).toBe('queued');
      await click('button=New run');
      await expect(field('Project')).toHaveValue('');
      await selectNative(field('Runtime profile'), journey.profileId);
      await click('button=Start run');
      await waitForTask(agent, generalTask.id, 'Desktop General worker');
      await click('button=Stop');
      await expect($('button=Stop')).not.toExist({ wait: 20000 });
      await lifecycle('stop_agent_server');
      expect((await lifecycle('start_agent_server'))?.state).toBe('running');
      const state = await browser.tauri.execute<
        Promise<{
          runs: {
            workspace?: { projectId: string | null; location?: string };
            active: boolean;
          }[];
        }>,
        []
      >(
        ({ core }) =>
          core.invoke('desktop_control_status') as Promise<{
            runs: {
              workspace?: { projectId: string | null; location?: string };
              active: boolean;
            }[];
          }>,
      );
      expect(state.runs).toHaveLength(2);
      expect(state.runs.every((run) => !run.active)).toBe(true);
      expect(state.runs.map((run) => run.workspace?.projectId)).toEqual(
        expect.arrayContaining([journey.projectId, null]),
      );
      await $('a=Projects').click();
      await expect($('h3=Personal work')).toBeDisplayed();
    } catch (error) {
      console.error(await browser.execute(() => document.body.innerText));
      await browser.saveScreenshot('test-results/desktop-docker-failure.png');
      throw error instanceof Error ? error : new Error(String(error));
    } finally {
      // A failed stop must not replace the error that ended the journey.
      await lifecycle('stop_agent_server').catch((error: unknown) => {
        console.error('Cleanup stop failed:', error);
      });
    }
  });
});
