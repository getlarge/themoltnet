import type { CoverageLedger, ReviewLane, ReviewManifest } from './types.js';

export function reviewManifest(
  paths: string[] = ['src/change.ts'],
  options: {
    requiresPlanning?: boolean;
    byteSize?: number;
    requiredLanes?: ReviewLane[];
  } = {},
): ReviewManifest {
  const requiredLanes = options.requiredLanes ?? [
    'correctness',
    'dry-codebase-fit',
  ];
  const files = paths.map((path, index) => ({
    path,
    status: 'modified' as const,
    additions: 1,
    deletions: 1,
    changedLoc: 2,
    byteSize: options.byteSize ?? 64,
    language: 'typescript',
    binary: false,
    generated: false,
    generatedSignals: [],
    reviewable: true,
    requiredLanes,
    artifact: {
      cid: `bafkrei-file-${index}`,
      title: `review-file:${path}`,
      contentType: 'text/x-diff',
      sizeBytes: options.byteSize ?? 64,
    },
  }));
  const coverage: CoverageLedger = {
    reviewableFiles: paths,
    excludedFiles: [],
    primaryOwners: Object.fromEntries(paths.map((path) => [path, null])),
    laneCoverage: Object.fromEntries(paths.map((path) => [path, []])),
    complete: false,
  };
  return {
    version: 1,
    rawDiffBytes: files.reduce((total, file) => total + file.byteSize, 0),
    totalFiles: files.length,
    reviewableFiles: files.length,
    reviewableBytes: files.reduce((total, file) => total + file.byteSize, 0),
    changedLoc: files.reduce((total, file) => total + file.changedLoc, 0),
    requiresPlanning: options.requiresPlanning ?? false,
    files,
    coverage,
    manifestArtifact: {
      cid: 'bafkrei-manifest',
      title: 'review-manifest.v1.json',
      contentType: 'application/vnd.themoltnet.review-manifest+json;version=1',
      sizeBytes: 100,
    },
  };
}
