import { fireEvent, render, screen } from '@testing-library/react';
import { MoltThemeProvider } from '@themoltnet/design-system';
import { describe, expect, it, vi } from 'vitest';

import type { EntryDetailData } from '../src/components/EntryDetail.js';
import { EntryDetail } from '../src/components/EntryDetail.js';

const ENTRY_ID = '11111111-1111-4111-8111-111111111111';
const RELATED_ID = '22222222-2222-4222-8222-222222222222';
const CID = 'bafkreiearfzy52cdm4hkkjku4eiusca73cnegtwufokzvwgb2quucymkvq';

function makeData(overrides: Partial<EntryDetailData> = {}): EntryDetailData {
  return {
    diary: null,
    entry: {
      id: ENTRY_ID,
      diaryId: 'diary-1',
      title: 'An entry',
      content: 'Some content.',
      tags: ['scope:console', 'design-system'],
      importance: 5,
      entryType: 'semantic',
      accessCount: 0,
      lastAccessedAt: null,
      injectionRisk: false,
      contentHash: CID,
      contentSignature: null,
      createdAt: '2026-06-25T10:00:00.000Z',
      updatedAt: '2026-06-25T10:00:00.000Z',
      creator: {
        kind: 'agent',
        fingerprint: '1671-B080-99BF-4270',
        identityId: 'a854b555-aeef-4f13-ab22-8d0b819d478e',
        publicKey: 'ed25519:wBkbENwyQSOnY+OZIsVX1F3b35JvQ42juWDXyqTapN4=',
      },
      relations: {
        maxDepth: 1,
        requestedDepth: 1,
        items: [
          {
            id: 'relation-1',
            relation: 'elaborates',
            status: 'accepted',
            sourceId: RELATED_ID,
            targetId: ENTRY_ID,
            depth: 1,
            parentRelationId: null,
            confidence: null,
            similarity: null,
            sourceCidSnapshot: null,
            targetCidSnapshot: null,
            workflowId: null,
            createdAt: '2026-06-25T10:00:00.000Z',
            updatedAt: '2026-06-25T10:00:00.000Z',
          },
        ],
      },
    },
    verification: null,
    ...overrides,
  };
}

function renderDetail(overrides: Partial<EntryDetailData> = {}) {
  const onBack = vi.fn();
  const onTagClick = vi.fn();
  const onRelationOpen = vi.fn();

  render(
    <MoltThemeProvider>
      <EntryDetail
        data={makeData(overrides)}
        onBack={onBack}
        onTagClick={onTagClick}
        onRelationOpen={onRelationOpen}
      />
    </MoltThemeProvider>,
  );

  return { onBack, onTagClick, onRelationOpen };
}

describe('EntryDetail composition', () => {
  it('renders the attribution panel', () => {
    renderDetail();

    expect(screen.getByText('Attribution')).toBeInTheDocument();
    expect(screen.getByText(CID)).toBeInTheDocument();
    expect(screen.getByText('Unsigned')).toBeInTheDocument();
  });

  it('renders the relation list with direction applied', () => {
    renderDetail();

    expect(screen.getByText('Relations')).toBeInTheDocument();
    expect(screen.getByText('Elaborated by')).toBeInTheDocument();
  });

  it('renders the creation timestamp exactly once', () => {
    renderDetail();

    expect(screen.getAllByText('Created')).toHaveLength(1);
  });

  it('wires relation navigation through to the caller', () => {
    const { onRelationOpen } = renderDetail();

    fireEvent.click(screen.getByRole('button', { name: /elaborated by/i }));

    expect(onRelationOpen).toHaveBeenCalledWith(RELATED_ID);
  });

  it('wires tag navigation through to the caller', () => {
    const { onTagClick } = renderDetail();

    fireEvent.click(screen.getByText('design-system'));

    expect(onTagClick).toHaveBeenCalledWith('design-system');
  });

  it('wires the back action through to the caller', () => {
    const { onBack } = renderDetail();

    fireEvent.click(screen.getByRole('button', { name: /diary/i }));

    expect(onBack).toHaveBeenCalled();
  });
});
