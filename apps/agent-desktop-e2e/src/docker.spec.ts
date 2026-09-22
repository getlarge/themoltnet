import type { DesktopStatus } from '@moltnet/agent-desktop/bridge';
import { $, browser, expect } from '@wdio/globals';

import { journeyAgent } from './docker-journey.js';
import { enableNativePolling, selectNative } from './native-visibility.js';

const field = (label: string) =>
  $(`//label[normalize-space()="${label}"]/following-sibling::select`);
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
async function lifecycle(command: string) {
  let state: DesktopStatus | undefined;
  let failure: unknown;
  await browser.waitUntil(
    async () => {
      try {
        state = await browser.tauri.execute<Promise<DesktopStatus>, [string]>(
          ({ core }, name) => core.invoke(name) as Promise<DesktopStatus>,
          command,
        );
        return true;
      } catch (error) {
        if (
          String(error).includes(
            'another desktop lifecycle operation is already in progress',
          )
        )
          return false;
        failure = error;
        return true;
      }
    },
    { timeout: 20000, interval: 200 },
  );
  if (failure)
    throw failure instanceof Error ? failure : new Error(String(failure));
  return state;
}

describe('Personal Desktop journey against Docker services', () => {
  it('manages a location, claims project and General work separately, and persists captured history', async () => {
    const root = process.env.MOLTNET_DESKTOP_E2E_FIXTURE_ROOT;
    if (!root) throw new Error('Use the isolated Docker launcher');
    await enableNativePolling();
    const { agent, journey } = await journeyAgent(root);
    await browser.waitUntil(
      async () => {
        const state = await browser.tauri.execute<Promise<DesktopStatus>, []>(
          ({ core }) => core.invoke('desktop_status') as Promise<DesktopStatus>,
        );
        return state.state === 'running';
      },
      { timeout: 20000 },
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
      await browser.waitUntil(
        async () => {
          const task = await agent.tasks.get(projectTask.id);
          if (task.status === 'failed')
            throw new Error('Desktop task failed: ' + task.id);
          return task.status === 'completed';
        },
        {
          timeout: 60000,
          interval: 500,
          timeoutMsg:
            'Desktop project worker did not complete the real API task',
        },
      );
      expect((await agent.tasks.get(generalTask.id)).status).toBe('queued');
      await click('button=Stop');
      await expect($('button=Stop')).not.toExist({ wait: 20000 });
      await click('button=New run');
      await expect(field('Project')).toHaveValue('');
      await selectNative(field('Runtime profile'), journey.profileId);
      await click('button=Start run');
      await browser.waitUntil(
        async () => {
          const task = await agent.tasks.get(generalTask.id);
          if (task.status === 'failed')
            throw new Error('Desktop task failed: ' + task.id);
          return task.status === 'completed';
        },
        {
          timeout: 60000,
          interval: 500,
          timeoutMsg:
            'Desktop General worker did not complete the real API task',
        },
      );
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
      await lifecycle('stop_agent_server');
    }
  });
});
