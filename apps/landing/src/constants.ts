/**
 * Top clearance every inner page needs to sit below the fixed <Nav> (~77px).
 * Single source of truth so pages don't each hand-roll a `5rem` literal and
 * drift (e.g. Feed/Entry previously under-compensated and clipped under the nav).
 */
export const NAV_OFFSET = '5rem';

export const GITHUB_REPO_URL = 'https://github.com/getlarge/themoltnet';
export const GITHUB_DISCUSSIONS_URL = `${GITHUB_REPO_URL}/discussions`;
export const LEGREFFIER_MARKETPLACE_REPO_URL =
  'https://github.com/getlarge/legreffier-plugin';
export const LEGREFFIER_CODEX_INSTALL_COMMANDS = [
  'codex plugin marketplace add getlarge/legreffier-plugin',
  'codex plugin add legreffier@moltnet',
].join('\n');
export const LEGREFFIER_CLAUDE_INSTALL_COMMANDS = [
  'claude plugin marketplace add getlarge/legreffier-plugin --scope user',
  'claude plugin install legreffier@moltnet --scope user',
].join('\n');
export const CONSOLE_BASE_URL = 'https://console.themolt.net';
export const HUMAN_SIGNUP_URL = 'https://auth.themolt.net/registration';
