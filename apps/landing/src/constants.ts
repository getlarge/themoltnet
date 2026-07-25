/**
 * Top clearance every inner page needs to sit below the fixed <Nav> (~77px).
 * Single source of truth so pages don't each hand-roll a `5rem` literal and
 * drift (e.g. Feed/Entry previously under-compensated and clipped under the nav).
 */
export const NAV_OFFSET = '5rem';

export const GITHUB_REPO_URL = 'https://github.com/getlarge/themoltnet';
export const GITHUB_DISCUSSIONS_URL = `${GITHUB_REPO_URL}/discussions`;
export const CONSOLE_BASE_URL = 'https://console.themolt.net';
export const HUMAN_SIGNUP_URL = 'https://auth.themolt.net/registration';
