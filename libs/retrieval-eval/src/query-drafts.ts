import { type Dataset, type Query, validateDataset } from './dataset.js';
import { hash } from './hash.js';

export interface QueryDraft {
  id: string;
  text: string;
  family: string;
  split: Query['split'];
  informationNeed: string;
}

/** Start a new query experiment; original snapshots and judgments stay intact. */
export function prepareQueryExperiment(
  source: Dataset,
  input: unknown,
  version: string,
) {
  validateDataset(source);
  if (!version.trim() || version === source.version)
    throw new Error('Choose a new nonempty dataset version');
  if (!Array.isArray(input) || input.length === 0)
    throw new Error('Queries must be a nonempty JSON array');
  const drafts: QueryDraft[] = input.map((value: unknown) => {
    if (!value || typeof value !== 'object')
      throw new Error('Invalid query draft');
    const d = value as Record<string, unknown>;
    for (const key of ['id', 'text', 'family', 'informationNeed'])
      if (typeof d[key] !== 'string' || !d[key].trim())
        throw new Error(`Query draft requires ${key}`);
    if (d.split !== 'development' && d.split !== 'test')
      throw new Error('Query draft requires development or test split');
    return {
      id: d.id as string,
      text: d.text as string,
      family: d.family as string,
      informationNeed: d.informationNeed as string,
      split: d.split,
    };
  });
  const queries = drafts.map((query) => ({
    id: query.id,
    text: query.text,
    family: query.family,
    split: query.split,
    textHash: hash(query.text),
  }));
  const dataset: Dataset = {
    ...source,
    version,
    labelRevision: 0,
    provenance: {
      ...source.provenance,
      description: `Query experiment derived from ${source.version} (${hash(source)}). Source entries and sampling are preserved; queries are local drafts and no relevance judgments are inherited.`,
    },
    queries,
    judgments: [],
  };
  validateDataset(dataset);
  return {
    dataset,
    proposals: {
      schemaVersion: 1,
      datasetHash: hash(dataset),
      datasetVersion: version,
      queries: queries.map((query, index) => ({
        ...query,
        informationNeed: drafts[index].informationNeed,
      })),
    },
  };
}
