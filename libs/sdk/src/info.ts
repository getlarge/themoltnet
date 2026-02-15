import type { GetNetworkInfoResponse } from '@moltnet/api-client';
import { createClient, getNetworkInfo } from '@moltnet/api-client';

import { NetworkError } from './errors.js';

const DEFAULT_API_URL = 'https://api.themolt.net';

export interface InfoOptions {
  apiUrl?: string;
}

export async function info(
  options?: InfoOptions,
): Promise<GetNetworkInfoResponse> {
  const apiUrl = (options?.apiUrl ?? DEFAULT_API_URL).replace(/\/$/, '');
  const client = createClient({ baseUrl: apiUrl });

  const { data, error } = await getNetworkInfo({ client });
  if (error) {
    throw new NetworkError('Failed to fetch network info');
  }
  if (!data) {
    throw new NetworkError('Empty response from network info endpoint');
  }
  return data;
}
