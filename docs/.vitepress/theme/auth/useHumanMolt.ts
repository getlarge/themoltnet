import { connectHuman } from '@themoltnet/sdk/human';

import { getApiBaseUrl } from './api';

export function useHumanMolt() {
  return connectHuman({ apiUrl: getApiBaseUrl() });
}
