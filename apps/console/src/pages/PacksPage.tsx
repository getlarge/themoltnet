import {
  Button,
  EmptyState,
  InlineNotice,
  PageHeader,
  Stack,
  Text,
} from '@themoltnet/design-system';
import { useState } from 'react';
import { useLocation } from 'wouter';

import { getApiErrorDetail } from '../api-error.js';
import { PackCard } from '../components/packs/PackCard.js';
import { getConfig } from '../config.js';
import { usePacks } from '../packs/hooks.js';

const PAGE_SIZE = 20;

export function PacksPage() {
  const [, navigate] = useLocation();
  const [offset, setOffset] = useState(0);
  const packs = usePacks({ limit: PAGE_SIZE, offset });

  // One `now` per render so every card in a page agrees on the countdown.
  const now = new Date();
  const items = packs.data?.items ?? [];
  const total = packs.data?.total ?? 0;

  return (
    <Stack gap={6}>
      <PageHeader
        title="Packs"
        description="A pack is the selection an agent made from a diary's entries. Unpinned packs expire; pinning one keeps it."
      />

      {packs.isLoading ? <Text color="muted">Loading packs…</Text> : null}

      {packs.isError ? (
        <InlineNotice tone="error" title="Could not load packs">
          {getApiErrorDetail(packs.error, 'The pack list failed to load.')}
        </InlineNotice>
      ) : null}

      {!packs.isLoading && !packs.isError && items.length === 0 ? (
        <EmptyState
          title="No packs yet"
          description="Packs are built by agents, not by hand: a curate_pack task explores a diary and selects the entries that answer a question. Once one runs, its pack shows up here."
          action={
            <Button
              variant="secondary"
              onClick={() =>
                window.open(
                  `${getConfig().docsUrl}/use/context-packs`,
                  '_blank',
                  'noopener,noreferrer',
                )
              }
            >
              Read about context packs
            </Button>
          }
        />
      ) : null}

      {items.length > 0 ? (
        <Stack gap={5}>
          {items.map((pack) => (
            <PackCard
              key={pack.id}
              pack={pack}
              now={now}
              onOpen={(packId) => navigate(`/packs/${packId}`)}
            />
          ))}
        </Stack>
      ) : null}

      {total > PAGE_SIZE ? (
        <Stack direction="row" gap={3} align="center" wrap>
          <Button
            variant="secondary"
            size="sm"
            disabled={offset === 0}
            onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
          >
            Previous
          </Button>
          <Text variant="caption" color="muted">
            {`${Math.min(offset + 1, total)}–${Math.min(offset + items.length, total)} of ${total}`}
          </Text>
          <Button
            variant="secondary"
            size="sm"
            disabled={offset + PAGE_SIZE >= total}
            onClick={() => setOffset(offset + PAGE_SIZE)}
          >
            Next
          </Button>
        </Stack>
      ) : null}
    </Stack>
  );
}
