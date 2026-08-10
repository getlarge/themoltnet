import { render, screen } from '@testing-library/react';
import { MoltThemeProvider } from '@themoltnet/design-system';
import type { ReactElement } from 'react';
import { describe, expect, it } from 'vitest';

import type {
  AttributionEntry,
  AttributionPanelProps,
} from '../src/components/AttributionPanel.js';
import {
  AttributionPanel,
  partitionProvenanceTags,
} from '../src/components/AttributionPanel.js';
import type { EntryVerifyResult } from '../src/types.js';

const AGENT_CREATOR = {
  kind: 'agent' as const,
  fingerprint: '1671-B080-99BF-4270',
  identityId: 'a854b555-aeef-4f13-ab22-8d0b819d478e',
  publicKey: 'ed25519:wBkbENwyQSOnY+OZIsVX1F3b35JvQ42juWDXyqTapN4=',
};

const CID = 'bafkreiearfzy52cdm4hkkjku4eiusca73cnegtwufokzvwgb2quucymkvq';

function makeEntry(
  overrides: Partial<AttributionEntry> = {},
): AttributionEntry {
  return {
    contentHash: CID,
    contentSignature: null,
    createdAt: '2026-06-25T10:00:00.000Z',
    creator: AGENT_CREATOR,
    tags: null,
    ...overrides,
  };
}

/** What the API actually returns for an entry that was never signed. */
const UNSIGNED_VERIFICATION: EntryVerifyResult = {
  signed: false,
  hashMatches: false,
  signatureValid: false,
  valid: false,
  contentHash: null,
  agentFingerprint: null,
};

const VERIFIED_VERIFICATION: EntryVerifyResult = {
  signed: true,
  hashMatches: true,
  signatureValid: true,
  valid: true,
  contentHash: CID,
  agentFingerprint: '1671-B080-99BF-4270',
};

function renderPanel(props: Partial<AttributionPanelProps> = {}) {
  const element: ReactElement = (
    <AttributionPanel
      entry={props.entry ?? makeEntry()}
      verification={props.verification ?? null}
    />
  );
  return render(<MoltThemeProvider>{element}</MoltThemeProvider>);
}

describe('AttributionPanel signature state', () => {
  it('reports a verified entry as verified and names the signing agent', () => {
    renderPanel({
      entry: makeEntry({ contentSignature: 'c2lnbmF0dXJl' }),
      verification: VERIFIED_VERIFICATION,
    });

    expect(screen.getByText('Verified')).toBeInTheDocument();
    expect(
      screen.getAllByText('1671-B080-99BF-4270').length,
    ).toBeGreaterThanOrEqual(1);
  });

  it('reads an unsigned entry as unsigned, never as failed or invalid', () => {
    const { container } = renderPanel({
      entry: makeEntry({ contentSignature: null }),
      verification: UNSIGNED_VERIFICATION,
    });

    expect(screen.getByText('Unsigned')).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/failed|invalid|tamper/i);
    expect(screen.queryByText('Verified')).not.toBeInTheDocument();
  });

  it('explains that signing is opt-in rather than implying something went wrong', () => {
    renderPanel({
      entry: makeEntry({ contentSignature: null }),
      verification: UNSIGNED_VERIFICATION,
    });

    expect(screen.getByText(/opt-in/i)).toBeInTheDocument();
  });

  it('reports a signature that has not been checked yet as unverified, not unsigned', () => {
    renderPanel({
      entry: makeEntry({ contentSignature: 'c2lnbmF0dXJl' }),
      verification: null,
    });

    expect(screen.getByText('Unverified')).toBeInTheDocument();
    expect(screen.queryByText('Unsigned')).not.toBeInTheDocument();
  });

  it('flags a content hash mismatch as content changed since signing', () => {
    renderPanel({
      entry: makeEntry({ contentSignature: 'c2lnbmF0dXJl' }),
      verification: {
        ...VERIFIED_VERIFICATION,
        hashMatches: false,
        signatureValid: true,
        valid: false,
      },
    });

    expect(
      screen.getByText(/content changed since signing/i),
    ).toBeInTheDocument();
  });

  it('distinguishes a signature that did not verify from a content mismatch', () => {
    renderPanel({
      entry: makeEntry({ contentSignature: 'c2lnbmF0dXJl' }),
      verification: {
        ...VERIFIED_VERIFICATION,
        hashMatches: true,
        signatureValid: false,
        valid: false,
      },
    });

    expect(screen.getByText(/signature did not verify/i)).toBeInTheDocument();
    expect(
      screen.queryByText(/content changed since signing/i),
    ).not.toBeInTheDocument();
  });
});

describe('AttributionPanel evidence', () => {
  it('renders the entry content hash even when verification carries none', () => {
    renderPanel({
      entry: makeEntry({ contentSignature: null }),
      verification: UNSIGNED_VERIFICATION,
    });

    expect(screen.getByText(CID)).toBeInTheDocument();
  });

  it('states that the signature covers the content hash, not the author field', () => {
    const { container } = renderPanel({
      entry: makeEntry({ contentSignature: 'c2lnbmF0dXJl' }),
      verification: VERIFIED_VERIFICATION,
    });

    expect(container.textContent).toMatch(/content hash/i);
    expect(container.textContent).toMatch(/not.*author/i);
  });

  it('notes that attribution is separate from access', () => {
    const { container } = renderPanel();

    expect(container.textContent).toMatch(/access/i);
    expect(container.textContent).toMatch(/who wrote/i);
  });

  it('identifies a human creator without inventing a fingerprint', () => {
    renderPanel({
      entry: makeEntry({
        creator: {
          kind: 'human',
          humanId: '9f0f2b58-0d63-4a1e-9a7f-4c9b7f1f2a11',
          identityId: null,
        },
      }),
    });

    expect(screen.getByText(/human/i)).toBeInTheDocument();
    expect(
      screen.getByText('9f0f2b58-0d63-4a1e-9a7f-4c9b7f1f2a11'),
    ).toBeInTheDocument();
  });
});

describe('AttributionPanel tags', () => {
  it('groups machine-emitted provenance tags separately from free tags', () => {
    renderPanel({
      entry: makeEntry({
        tags: [
          'accountable-commit',
          'branch:issue-1853-entry-evidence',
          'scope:console',
          'task:abc-123',
          'design-system',
        ],
      }),
    });

    const provenance = screen.getByRole('group', { name: /provenance/i });
    const free = screen.getByRole('group', { name: /^tags$/i });

    expect(provenance).toHaveTextContent('branch:issue-1853-entry-evidence');
    expect(provenance).toHaveTextContent('scope:console');
    expect(provenance).toHaveTextContent('accountable-commit');
    expect(provenance).not.toHaveTextContent('design-system');
    expect(free).toHaveTextContent('design-system');
    expect(free).not.toHaveTextContent('scope:console');
  });

  it('omits a tag group entirely when it has no members', () => {
    renderPanel({ entry: makeEntry({ tags: ['design-system'] }) });

    expect(
      screen.queryByRole('group', { name: /provenance/i }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('group', { name: /^tags$/i })).toBeInTheDocument();
  });
});

describe('partitionProvenanceTags', () => {
  it('splits on the accountable-commit vocabulary and preserves order', () => {
    expect(
      partitionProvenanceTags([
        'ui',
        'task-group:kf-console',
        'risk:low',
        'incident',
        'issue:1853',
        'pr:1900',
      ]),
    ).toEqual({
      provenance: [
        'task-group:kf-console',
        'risk:low',
        'issue:1853',
        'pr:1900',
      ],
      free: ['ui', 'incident'],
    });
  });

  it('treats a null tag list as two empty groups', () => {
    expect(partitionProvenanceTags(null)).toEqual({
      provenance: [],
      free: [],
    });
  });
});
