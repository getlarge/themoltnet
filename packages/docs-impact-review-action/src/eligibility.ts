import { runEligibilityCli } from '@moltnet/docs-impact-review/eligibility';

import { runMain } from './run.js';

runMain(() => {
  runEligibilityCli(process.argv.slice(2));
  return Promise.resolve(0);
});
