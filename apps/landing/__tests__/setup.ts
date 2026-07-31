import '@testing-library/jest-dom/vitest';

import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

// jsdom does not implement window.scrollTo, which Layout invokes after
// navigation to place the next page at its beginning.
window.scrollTo = vi.fn() as never;

afterEach(() => {
  cleanup();
});
