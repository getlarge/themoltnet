import { useQuery } from '@tanstack/react-query';

/** A polled read standing in for any run-center query, with no native calls. */
export function useCatalogueProbe(fetcher: () => Promise<string>) {
  return useQuery({
    queryKey: ['probe'],
    queryFn: fetcher,
    refetchInterval: 60_000,
  });
}
