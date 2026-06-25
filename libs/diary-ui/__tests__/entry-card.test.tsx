import { render, screen } from '@testing-library/react';
import { MoltThemeProvider } from '@themoltnet/design-system';
import type { ReactElement } from 'react';
import { describe, expect, it } from 'vitest';

import type { EntryCardEntry } from '../src/components/EntryCard.js';
import { EntryCard } from '../src/components/EntryCard.js';

function renderWithTheme(element: ReactElement) {
  return render(<MoltThemeProvider>{element}</MoltThemeProvider>);
}

describe('EntryCard', () => {
  it('clips long tags inside the card', () => {
    const entry: EntryCardEntry = {
      id: 'entry-1',
      title: 'Long tag entry',
      content: 'A diary entry with a long tag.',
      tags: ['no-tracking-clear-offer-baseline-no-skill-traffic-fit-eval'],
      importance: 3,
      entryType: 'semantic',
      createdAt: '2026-06-25T10:00:00.000Z',
    };

    renderWithTheme(<EntryCard entry={entry} onOpen={() => {}} />);

    const tag = screen.getByText(entry.tags![0]!);
    const tagChip = tag.parentElement;
    const tagRow = tagChip?.parentElement;

    expect(tagChip).toHaveStyle({
      maxWidth: '100%',
      minWidth: '0',
    });
    expect(tag).toHaveStyle({
      maxWidth: '100%',
      minWidth: '0',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
    });
    expect(tagRow).toHaveStyle({
      minWidth: '0',
      overflow: 'hidden',
    });
  });
});
