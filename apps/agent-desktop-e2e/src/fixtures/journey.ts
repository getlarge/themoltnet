import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * What the Docker journey spec needs: ids, plus the disposable OAuth client it
 * uses to create and inspect tasks.
 */
export interface DesktopDockerJourney {
  apiUrl: string;
  clientId: string;
  clientSecret: string;
  teamId: string;
  diaryId: string;
  projectId: string;
  profileId: string;
}

/** Written by setup.ts; the identity is removed once it is in the isolated store. */
export interface DesktopDockerJourneySetup extends DesktopDockerJourney {
  identity: {
    subjectId: string;
    publicKey: string;
    privateKey: string;
    fingerprint: string;
    agentKey: string;
  };
}

const journeyPath = (root: string) => join(root, 'docker-journey.json');

export function writeJourney(
  root: string,
  journey: DesktopDockerJourney | DesktopDockerJourneySetup,
): void {
  writeFileSync(journeyPath(root), JSON.stringify(journey), { mode: 0o600 });
}

export function readJourneySetup(root: string): DesktopDockerJourneySetup {
  return JSON.parse(
    readFileSync(journeyPath(root), 'utf8'),
  ) as DesktopDockerJourneySetup;
}

export function readJourney(root: string): DesktopDockerJourney {
  return JSON.parse(
    readFileSync(journeyPath(root), 'utf8'),
  ) as DesktopDockerJourney;
}
