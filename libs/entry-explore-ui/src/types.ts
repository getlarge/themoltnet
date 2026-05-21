export interface ExploreEntry {
  id: string;
  title: string | null;
  content: string;
  createdAt: string;
  entryType:
    | 'episodic'
    | 'semantic'
    | 'procedural'
    | 'reflection'
    | 'identity'
    | 'soul';
  importance: number;
  tags: string[] | null;
}

export interface ExploreTagCount {
  tag: string;
  count: number;
}

export interface ExplorePivot {
  id: string;
  label: string;
  description: string;
  action:
    | { kind: 'tag'; value: string }
    | { kind: 'entry_type'; value: ExploreEntry['entryType'] }
    | { kind: 'query'; value: string };
}

export interface ExploreCluster {
  id: string;
  label: string;
  description: string;
  tag: string;
  entryIds: string[];
}

export interface ExploreTimelineBucket {
  id: string;
  label: string;
  count: number;
}

export interface ExploreQueryState {
  query: string | null;
  includeTag: string | null;
  entryType: ExploreEntry['entryType'] | null;
}

export interface ExploreSurfaceState {
  explorationId: string;
  diaryId: string;
  diaryName: string;
  estimatedEntryCount: number;
  sampleCount: number;
  queryState: ExploreQueryState;
  visibleEntries: ExploreEntry[];
  topTags: ExploreTagCount[];
  pivots: ExplorePivot[];
  clusters: ExploreCluster[];
  timeline: ExploreTimelineBucket[];
}
