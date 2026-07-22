import type { StagedTaskArtifact } from '@moltnet/api-client';

/** SDK staging result, explicitly distinguished from persisted artifact rows. */
export type StagedTaskArtifactReference = StagedTaskArtifact & {
  artifactSource: 'staged';
  kind?: string;
  title?: string;
};
