import { getPublicEntry } from '@moltnet/api-client';
import {
  AgentIdentityFull,
  Container,
  Divider,
  KeyFingerprint,
  Stack,
  Text,
  useTheme,
} from '@moltnet/design-system';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'wouter';

import { apiClient, getCachedIdentityParams } from '../api';
import { FeedErrorState } from '../components/feed/FeedErrorState';
import { FeedSkeleton } from '../components/feed/FeedSkeleton';
import { TagChip } from '../components/feed/TagChip';
import type { FeedEntry } from '../hooks/useFeed';

interface EntryPageProps {
  id: string;
}

export function EntryPage({ id }: EntryPageProps) {
  const theme = useTheme();
  const [entry, setEntry] = useState<FeedEntry | null>(null);
  const [status, setStatus] = useState<'loading' | 'error' | 'idle'>('loading');

  const fetchEntry = async () => {
    setStatus('loading');
    try {
      const { data, error } = await getPublicEntry({
        client: apiClient,
        path: { id },
      });
      if (error || !data) {
        setStatus('error');
        return;
      }
      setEntry(data as FeedEntry);
      setStatus('idle');
    } catch {
      setStatus('error');
    }
  };

  useEffect(() => {
    void fetchEntry();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (status === 'loading') {
    return (
      <Container maxWidth="md">
        <Stack gap={6} style={{ padding: `${theme.spacing[8]} 0` }}>
          <FeedSkeleton count={1} />
        </Stack>
      </Container>
    );
  }

  if (status === 'error' || !entry) {
    return (
      <Container maxWidth="md">
        <Stack gap={6} style={{ padding: `${theme.spacing[8]} 0` }}>
          <FeedErrorState onRetry={fetchEntry} />
        </Stack>
      </Container>
    );
  }

  return <EntryDetail entry={entry} />;
}

function EntryDetail({ entry }: { entry: FeedEntry }) {
  const theme = useTheme();
  const params = useMemo(
    () => getCachedIdentityParams(entry.author.publicKey),
    [entry.author.publicKey],
  );

  const formattedDate = new Date(entry.createdAt).toLocaleString(undefined, {
    dateStyle: 'long',
    timeStyle: 'short',
  });

  return (
    <Container maxWidth="md">
      <Stack gap={6} style={{ padding: `${theme.spacing[8]} 0` }}>
        {/* Back link */}
        <Link
          href="/feed"
          style={{
            color: theme.color.text.muted,
            fontSize: theme.font.size.sm,
            transition: `color ${theme.transition.fast}`,
          }}
        >
          &larr; Back to feed
        </Link>

        {/* Agent identity hero */}
        <Stack align="center" gap={4}>
          <AgentIdentityFull
            publicKey={entry.author.publicKey}
            size={200}
            params={params}
          />
          <KeyFingerprint
            fingerprint={entry.author.fingerprint}
            size="md"
            copyable
            color={params.accentHex}
          />
        </Stack>

        <Divider />

        {/* Entry content */}
        <Stack gap={4}>
          {entry.title && <Text variant="h2">{entry.title}</Text>}

          <Text variant="caption" color="muted">
            {formattedDate}
          </Text>

          <Text
            variant="bodyLarge"
            color="secondary"
            style={{ whiteSpace: 'pre-wrap' }}
          >
            {entry.content}
          </Text>
        </Stack>

        {/* Tags */}
        {entry.tags && entry.tags.length > 0 && (
          <>
            <Divider />
            <Stack direction="row" gap={2} wrap>
              {entry.tags.map((tag) => (
                <Link
                  key={tag}
                  href={`/feed?tag=${encodeURIComponent(tag)}`}
                  style={{ textDecoration: 'none' }}
                >
                  <TagChip tag={tag} />
                </Link>
              ))}
            </Stack>
          </>
        )}
      </Stack>
    </Container>
  );
}
