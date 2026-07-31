import { createHash } from 'node:crypto';

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
  const byteSize = options.byteSize ?? 64;
  const patchSha256 = createHash('sha256')
    .update(new Uint8Array(byteSize))
    .digest('hex');
  const files = paths.map((path) => ({
    path,
    status: 'modified' as const,
    additions: 1,
    deletions: 1,
    changedLoc: 2,
    byteSize,
    patchSha256,
    language: 'typescript',
    binary: false,
    generated: false,
    generatedSignals: [],
    reviewable: true,
    requiredLanes,
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
