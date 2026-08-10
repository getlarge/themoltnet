import { fireEvent, render, screen } from '@testing-library/react';
import { MoltThemeProvider } from '@themoltnet/design-system';
import { describe, expect, it, vi } from 'vitest';

import { RelationList } from '../src/components/RelationList.js';
import type {
  EntryRelationWithDepth,
  RelationStatus,
  RelationType,
} from '../src/types.js';

const ENTRY_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_ID = '22222222-2222-4222-8222-222222222222';

let relationSeq = 0;

function makeRelation(
  overrides: Partial<EntryRelationWithDepth> = {},
): EntryRelationWithDepth {
  relationSeq += 1;
  return {
    id: `relation-${relationSeq}`,
    relation: 'references',
    status: 'accepted',
    sourceId: ENTRY_ID,
    targetId: OTHER_ID,
    depth: 1,
    parentRelationId: null,
    confidence: null,
    similarity: null,
    sourceCidSnapshot: null,
    targetCidSnapshot: null,
    workflowId: null,
    createdAt: '2026-06-25T10:00:00.000Z',
    updatedAt: '2026-06-25T10:00:00.000Z',
    ...overrides,
  };
}

/** An incoming relation: someone else points at this entry. */
function incoming(
  relation: RelationType,
  status: RelationStatus = 'accepted',
): EntryRelationWithDepth {
  return makeRelation({
    relation,
    status,
    sourceId: OTHER_ID,
    targetId: ENTRY_ID,
  });
}

function renderList(
  relations: EntryRelationWithDepth[] | undefined,
  onRelationOpen = vi.fn(),
) {
  const result = render(
    <MoltThemeProvider>
      <RelationList
        entryId={ENTRY_ID}
        relations={relations}
        onRelationOpen={onRelationOpen}
      />
    </MoltThemeProvider>,
  );
  return { ...result, onRelationOpen };
}

describe('RelationList supersession', () => {
  it('unmistakably marks an entry that an accepted supersedes relation targets', () => {
    renderList([incoming('supersedes')]);

    const notice = screen.getByRole('status');
    expect(notice).toHaveTextContent(/superseded/i);
  });

  it('does not mark the entry superseded when the supersedes relation is only proposed', () => {
    renderList([incoming('supersedes', 'proposed')]);

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getByText(/proposed/i)).toBeInTheDocument();
  });

  it('does not mark the entry superseded when it is the one doing the superseding', () => {
    renderList([makeRelation({ relation: 'supersedes' })]);

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getByText('Supersedes')).toBeInTheDocument();
  });

  it('does not mark the entry superseded by a rejected relation', () => {
    renderList([incoming('supersedes', 'rejected')]);

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});

describe('RelationList direction', () => {
  it('renders every relation type in the outgoing direction', () => {
    renderList([
      makeRelation({ relation: 'supersedes' }),
      makeRelation({ relation: 'elaborates' }),
      makeRelation({ relation: 'contradicts' }),
      makeRelation({ relation: 'supports' }),
      makeRelation({ relation: 'caused_by' }),
      makeRelation({ relation: 'references' }),
    ]);

    for (const label of [
      'Supersedes',
      'Elaborates',
      'Contradicts',
      'Supports',
      'Caused by',
      'References',
    ]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it('renders every relation type in the incoming direction', () => {
    renderList([
      incoming('supersedes'),
      incoming('elaborates'),
      incoming('contradicts'),
      incoming('supports'),
      incoming('caused_by'),
      incoming('references'),
    ]);

    for (const label of [
      'Superseded by',
      'Elaborated by',
      'Contradicted by',
      'Supported by',
      'Caused',
      'Referenced by',
    ]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });
});

describe('RelationList one-hop guarantee', () => {
  it('drops relations beyond the first hop', () => {
    renderList([
      makeRelation({ relation: 'references' }),
      makeRelation({
        relation: 'elaborates',
        depth: 2,
        sourceId: OTHER_ID,
        targetId: '33333333-3333-4333-8333-333333333333',
      }),
    ]);

    expect(screen.getByText('References')).toBeInTheDocument();
    expect(screen.queryByText('Elaborates')).not.toBeInTheDocument();
    expect(
      screen.queryByText('33333333-3333-4333-8333-333333333333'),
    ).not.toBeInTheDocument();
  });

  it('says nothing is related when every relation is beyond the first hop', () => {
    renderList([makeRelation({ depth: 2 })]);

    expect(screen.getByText(/no related entries/i)).toBeInTheDocument();
  });
});

describe('RelationList navigation', () => {
  it('opens the entry on the other end of the relation', () => {
    const { onRelationOpen } = renderList([incoming('elaborates')]);

    fireEvent.click(screen.getByRole('button', { name: /elaborated by/i }));

    expect(onRelationOpen).toHaveBeenCalledWith(OTHER_ID);
  });
});

describe('RelationList status', () => {
  it('labels a proposal as a suggestion rather than a fact', () => {
    renderList([makeRelation({ relation: 'supports', status: 'proposed' })]);

    expect(screen.getByText(/proposed/i)).toBeInTheDocument();
  });

  it('does not attribute a hand-created proposal to a workflow', () => {
    const { container } = renderList([
      makeRelation({
        relation: 'supports',
        status: 'proposed',
        workflowId: null,
      }),
    ]);

    expect(container.textContent).toMatch(/suggested\. not yet accepted/i);
    expect(container.textContent).not.toMatch(/workflow/i);
  });

  it('names a workflow only when the relation records one', () => {
    const { container } = renderList([
      makeRelation({
        relation: 'supports',
        status: 'proposed',
        workflowId: 'wf-1',
      }),
    ]);

    expect(container.textContent).toMatch(/suggested by a workflow/i);
  });

  it('labels a rejected relation', () => {
    renderList([makeRelation({ relation: 'supports', status: 'rejected' })]);

    expect(screen.getByText(/rejected/i)).toBeInTheDocument();
  });

  it('does not dim a rejected row below the AA contrast floor', () => {
    // `text.muted` sits at ~4.8:1 on `bg.surface` by design (#1643). Any
    // opacity on the row composites it toward the background — 0.6 lands at
    // ~2.5:1 — so rejection must be carried by non-colour signals instead.
    renderList([makeRelation({ relation: 'supports', status: 'rejected' })]);

    const row = screen.getByRole('button');
    expect(Number(row.style.opacity || '1')).toBe(1);
    expect(screen.getByText('Supports')).toHaveStyle({
      textDecoration: 'line-through',
    });
  });

  it('orders accepted relations before proposed and rejected ones', () => {
    renderList([
      makeRelation({ relation: 'contradicts', status: 'rejected' }),
      makeRelation({ relation: 'supports', status: 'proposed' }),
      makeRelation({ relation: 'elaborates', status: 'accepted' }),
    ]);

    const labels = screen
      .getAllByRole('button')
      .map((button) => button.textContent ?? '');

    expect(labels[0]).toMatch(/elaborates/i);
    expect(labels[1]).toMatch(/supports/i);
    expect(labels[2]).toMatch(/contradicts/i);
  });
});

describe('RelationList empty state', () => {
  it('handles a missing relations payload', () => {
    renderList(undefined);

    expect(screen.getByText(/no related entries/i)).toBeInTheDocument();
  });
});
