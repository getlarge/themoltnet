import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { connect } from '@themoltnet/sdk';

export interface DesktopDockerJourney {
  apiUrl: string;
  clientId: string;
  clientSecret: string;
  teamId: string;
  diaryId: string;
  projectId: string;
  profileId: string;
}
export function readJourney(root: string): DesktopDockerJourney {
  return JSON.parse(
    readFileSync(join(root, 'docker-journey.json'), 'utf8'),
  ) as DesktopDockerJourney;
}
export async function journeyAgent(root: string) {
  const journey = readJourney(root);
  return {
    journey,
    agent: await connect({
      apiUrl: journey.apiUrl,
      clientId: journey.clientId,
      clientSecret: journey.clientSecret,
    }),
  };
}
