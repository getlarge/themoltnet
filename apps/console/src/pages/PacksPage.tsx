import {
  Button,
  EmptyState,
  InlineNotice,
  PageHeader,
  Stack,
  Text,
} from '@themoltnet/design-system';
import { useEffect, useState } from 'react';
import { useLocation } from 'wouter';

import { getApiErrorDetail } from '../api-error.js';
import { PackCard } from '../components/packs/PackCard.js';
import { getConfig } from '../config.js';
import { usePacks } from '../packs/hooks.js';
import { useTeam } from '../team/useTeam.js';

const PAGE_SIZE = 20;

export function PacksPage() {
  const { selectedTeam } = useTeam();
  const [, navigate] = useLocation();
  const [offset, setOffset] = useState(0);
  const packs = usePacks({ limit: PAGE_SIZE, offset });

  // The catalog is team-scoped, so a team switch invalidates the page the
  // operator was on. Without this, offset can sit past the end of a smaller
  // team's list and strand them on an empty page.
  useEffect(() => {
    setOffset(0);
  }, [selectedTeam?.id]);

  const items = packs.data?.items ?? [];
  const total = packs.data?.total ?? 0;

  // The list can also shrink underneath a fixed offset — GC expires packs on a
  // timer. Clamp back to the last page that exists.
  useEffect(() => {
    if (offset > 0 && offset >= total && total >= 0 && !packs.isFetching) {
      setOffset(
        Math.max(0, Math.floor(Math.max(total - 1, 0) / PAGE_SIZE) * PAGE_SIZE),
      );
    }
  }, [offset, total, packs.isFetching]);

  // One `now` per render so every card in a page agrees on the countdown.
  const now = new Date();
  // Gate on offset too: a shrunken list must still offer a way back.
  const showPager = total > PAGE_SIZE || offset > 0;

  return (
    <Stack gap={6}>
      <PageHeader
        title="Packs"
        description="A pack is the selection an agent made from a diary's entries. Unpinned packs expire; pinning one keeps it."
      />

      {packs.isLoading ? <Text color="muted">Loading packs…</Text> : null}

      {packs.isError ? (
        <InlineNotice
          tone="error"
          title="Could not load packs"
          action={
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void packs.refetch()}
              disabled={packs.isFetching}
            >
              {packs.isFetching ? 'Retrying…' : 'Retry'}
            </Button>
          }
        >
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

      {showPager ? (
        <Stack direction="row" gap={3} align="center" wrap>
          <Button
            variant="secondary"
            size="sm"
            disabled={offset === 0 || packs.isFetching}
            onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
          >
            Previous
          </Button>
          <Text variant="caption" color="muted">
            {total === 0
              ? 'No packs on this page'
              : `${Math.min(offset + 1, total)}–${Math.min(offset + items.length, total)} of ${total}`}
          </Text>
          <Button
            variant="secondary"
            size="sm"
            disabled={offset + PAGE_SIZE >= total || packs.isFetching}
            onClick={() => setOffset(offset + PAGE_SIZE)}
          >
            Next
          </Button>
        </Stack>
      ) : null}
    </Stack>
  );
}
