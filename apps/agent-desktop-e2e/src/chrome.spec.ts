import { $, browser, expect } from '@wdio/globals';

const stopped = {
  state: 'stopped',
  installedVersion: '1.0.0',
  availableVersion: null,
  message: 'Server stopped.',
  logs: [],
};

describe('Desktop renderer through the native bridge boundary', () => {
  it('opens without starting the server and allows setup navigation', async () => {
    const start = await browser.tauri.mock('start_agent_server');
    await start.mockResolvedValue(stopped);
    const status = await browser.tauri.mock('desktop_status');
    await status.mockResolvedValue(stopped);
    await browser.execute(() =>
      window.dispatchEvent(new Event('desktop-e2e:mount')),
    );

    await expect($('button=New run')).toBeDisabled();
    await $('a=Identity and teams').click();
    await expect($('h1=Identity and teams')).toBeDisplayed();
    await start.update();
    expect(start.mock.calls).toHaveLength(0);
  });
});
