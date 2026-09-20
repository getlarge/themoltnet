import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';

import { MoltThemeProvider, Text } from '../src/index.js';

it('keeps variant weight when no explicit weight is supplied', () => {
  render(
    <MoltThemeProvider>
      <Text variant="h3">Heading</Text>
    </MoltThemeProvider>,
  );
  expect(screen.getByRole('heading').style.fontWeight).toBe('600');
});
