import { connect } from '@themoltnet/sdk';

import { readJourney } from './fixtures/journey.js';

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
