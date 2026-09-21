import { $, browser, expect } from '@wdio/globals';

import { preset } from './run-fixtures.js';

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
    await (
      await browser.tauri.mock('desktop_preset_storage_scope')
    ).mockResolvedValue({ storageScope: '' });
    const status = await browser.tauri.mock('desktop_status');
    await status.mockResolvedValue(stopped);
    await browser.execute((saved) => {
      localStorage.setItem('moltnet.run-presets.v1', JSON.stringify([saved]));
      window.dispatchEvent(new Event('desktop-e2e:mount'));
    }, preset);

    await expect($('button=New run')).toBeDisabled();
    await expect($('a=Saved worker')).toBeDisplayed();
    await $('a=Identity and teams').click();
    await expect($('body')).toHaveText(expect.stringContaining('Identity'));
    await start.update();
    expect(start.mock.calls).toHaveLength(0);
  });
});
