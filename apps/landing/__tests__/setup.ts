import '@testing-library/jest-dom/vitest';

import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

// jsdom does not implement <canvas>. MoltOrigin.tsx instantiates canvas
// for a decorative gradient; we don't assert on rendered pixels, so a
// stub is enough to silence "Not implemented" warnings. Same for
// window.scrollTo, which the same component invokes on mount.
HTMLCanvasElement.prototype.getContext = vi.fn(() => null) as never;
window.scrollTo = vi.fn() as never;

afterEach(() => {
  cleanup();
});
