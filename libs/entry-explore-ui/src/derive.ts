import type {
  ExploreCluster,
  ExploreEntry,
  ExplorePivot,
  ExploreSurfaceState,
  ExploreTagCount,
  ExploreTimelineBucket,
} from './types.js';

function trimText(content: string, max = 160): string {
  const normalized = content.replace(/\s+/g, ' ').trim();
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, max - 1)}…`;
}

function summarizeTag(tag: string): string {
  if (tag.includes(':')) {
    const [prefix, value] = tag.split(':', 2);
    return `${prefix} · ${value}`;
  }
  return tag;
}

function bucketMonthLabel(isoDate: string): string {
  const date = new Date(isoDate);
  return date.toLocaleDateString(undefined, {
    month: 'short',
    year: 'numeric',
  });
}

export function buildTimeline(
  entries: ExploreEntry[],
): ExploreTimelineBucket[] {
  const buckets = new Map<string, number>();
  for (const entry of entries) {
    const key = bucketMonthLabel(entry.createdAt);
    buckets.set(key, (buckets.get(key) ?? 0) + 1);
  }

  return [...buckets.entries()]
    .map(([label, count], index) => ({
      id: `timeline-${index}`,
      label,
      count,
    }))
    .slice(-8);
}

export function buildPivots(
  tags: ExploreTagCount[],
  entries: ExploreEntry[],
): ExplorePivot[] {
  const pivots: ExplorePivot[] = [];

  for (const tag of tags.slice(0, 3)) {
    pivots.push({
      id: `tag:${tag.tag}`,
      label: summarizeTag(tag.tag),
      description: `${tag.count} sampled entries`,
      action: { kind: 'tag', value: tag.tag },
    });
  }

  const byType = new Map<ExploreEntry['entryType'], number>();
  for (const entry of entries) {
    byType.set(entry.entryType, (byType.get(entry.entryType) ?? 0) + 1);
  }
  for (const [type, count] of [...byType.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)) {
    pivots.push({
      id: `type:${type}`,
      label: `${type} entries`,
      description: `${count} visible in current sample`,
      action: { kind: 'entry_type', value: type },
    });
  }

  const topical = tags.find((tag) => tag.tag.startsWith('topic:'));
  if (topical) {
    pivots.push({
      id: `query:${topical.tag}`,
      label: `Explore ${topical.tag.slice('topic:'.length)}`,
      description: 'Search around a recurring topic',
      action: { kind: 'query', value: topical.tag.replace(':', ' ') },
    });
  }

  return pivots.slice(0, 5);
}

export function buildClusters(
  tags: ExploreTagCount[],
  entries: ExploreEntry[],
): ExploreCluster[] {
  return tags
    .filter((tag) => tag.count >= 2)
    .slice(0, 4)
    .map((tag, index) => {
      const tagged = entries.filter((entry) => entry.tags?.includes(tag.tag));
      return {
        id: `cluster-${index}`,
        label: summarizeTag(tag.tag),
        description: `${tagged.length} visible entries share this thread`,
        tag: tag.tag,
        entryIds: tagged.slice(0, 8).map((entry) => entry.id),
      };
    });
}

export function distillEntries(entries: ExploreEntry[]): ExploreEntry[] {
  return entries.map((entry) => ({
    ...entry,
    title: entry.title?.trim() || null,
    content: trimText(entry.content),
  }));
}

export function buildExploreSurfaceState(input: {
  explorationId: string;
  diaryId: string;
  diaryName: string;
  estimatedEntryCount: number;
  sampleEntries: ExploreEntry[];
  visibleEntries: ExploreEntry[];
  topTags: ExploreTagCount[];
  queryState: ExploreSurfaceState['queryState'];
}): ExploreSurfaceState {
  const visibleEntries = distillEntries(input.visibleEntries);
  return {
    explorationId: input.explorationId,
    diaryId: input.diaryId,
    diaryName: input.diaryName,
    estimatedEntryCount: input.estimatedEntryCount,
    sampleCount: input.sampleEntries.length,
    queryState: input.queryState,
    visibleEntries,
    topTags: input.topTags.slice(0, 8),
    pivots: buildPivots(input.topTags, visibleEntries),
    clusters: buildClusters(input.topTags, visibleEntries),
    timeline: buildTimeline(input.sampleEntries),
  };
}
