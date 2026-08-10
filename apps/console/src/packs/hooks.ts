//
// Pack and rendered-pack queries.
//
// IMPORTANT: `usePackWithEntries` requests `expand=entries`, which inlines the
// full body of every entry in the pack. It is for ONE pack at a time. Never
// call it across a diary's packs to compute coverage or entry membership —
// see issue #1854 items 1 and 2 for why that was cut.
//
// Mirrors the shape of `../diaries/hooks.ts`, which is the house pattern.

import { updateContextPack, updateRenderedPack } from '@moltnet/api-client';
import {
  getContextPackByIdOptions,
  getContextPackProvenanceByIdOptions,
  getRenderedPackByIdOptions,
  listDiaryPacksOptions,
  listDiaryRenderedPacksOptions,
} from '@moltnet/api-client/query';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { getApiClient } from '../api.js';

function client() {
  return getApiClient();
}

/**
 * The generated `*Options` factories build keys with `createQueryKey()`, which
 * returns a single-element array wrapping an object: `[{ _id, baseUrl, path,
 * query }]`. Invalidating with a bare `['listDiaryPacks']` therefore matches
 * nothing. These predicates key off `_id` so a pin flips every affected query
 * regardless of which diary or pack it was scoped to.
 */
const PACK_QUERY_IDS = new Set([
  'listContextPacks',
  'listDiaryPacks',
  'getContextPackById',
  'getContextPackProvenanceById',
]);

const RENDERED_PACK_QUERY_IDS = new Set([
  'listDiaryRenderedPacks',
  'getRenderedPackById',
  'getLatestRenderedPack',
]);

function queryId(queryKey: unknown): string | undefined {
  if (!Array.isArray(queryKey)) return undefined;
  const head: unknown = queryKey[0];
  if (typeof head !== 'object' || head === null) return undefined;
  const id = (head as { _id?: unknown })._id;
  return typeof id === 'string' ? id : undefined;
}

export function isPackQueryKey(queryKey: unknown): boolean {
  const id = queryId(queryKey);
  return id !== undefined && PACK_QUERY_IDS.has(id);
}

export function isRenderedPackQueryKey(queryKey: unknown): boolean {
  const id = queryId(queryKey);
  return id !== undefined && RENDERED_PACK_QUERY_IDS.has(id);
}

export function useDiaryPacks(diaryId: string) {
  return useQuery({
    ...listDiaryPacksOptions({ client: client(), path: { id: diaryId } }),
    enabled: Boolean(diaryId),
    staleTime: 30_000,
  });
}

export function usePack(packId: string) {
  return useQuery({
    ...getContextPackByIdOptions({ client: client(), path: { id: packId } }),
    enabled: Boolean(packId),
    staleTime: 30_000,
  });
}

/** Single pack only — see the file-top note before calling this anywhere else. */
export function usePackWithEntries(packId: string) {
  return useQuery({
    ...getContextPackByIdOptions({
      client: client(),
      path: { id: packId },
      query: { expand: 'entries' },
    }),
    enabled: Boolean(packId),
    staleTime: 30_000,
  });
}

export function usePackProvenance(packId: string) {
  return useQuery({
    ...getContextPackProvenanceByIdOptions({
      client: client(),
      path: { id: packId },
    }),
    enabled: Boolean(packId),
    staleTime: 30_000,
  });
}

export function useDiaryRenderedPacks(diaryId: string) {
  return useQuery({
    ...listDiaryRenderedPacksOptions({
      client: client(),
      path: { id: diaryId },
    }),
    enabled: Boolean(diaryId),
    staleTime: 30_000,
  });
}

export function useRenderedPack(renderedPackId: string) {
  return useQuery({
    ...getRenderedPackByIdOptions({
      client: client(),
      path: { id: renderedPackId },
    }),
    enabled: Boolean(renderedPackId),
    staleTime: 30_000,
  });
}

export function usePinPack() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      packId,
      pinned,
    }: {
      packId: string;
      pinned: boolean;
    }) => {
      const { data, error } = await updateContextPack({
        client: client(),
        path: { id: packId },
        body: { pinned },
      });
      if (error || !data) throw new Error('Failed to update pin state');
      return data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        predicate: (query) => isPackQueryKey(query.queryKey),
      });
    },
  });
}

export function usePinRenderedPack() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      renderedPackId,
      pinned,
    }: {
      renderedPackId: string;
      pinned: boolean;
    }) => {
      const { data, error } = await updateRenderedPack({
        client: client(),
        path: { id: renderedPackId },
        body: { pinned },
      });
      if (error || !data) throw new Error('Failed to update pin state');
      return data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        predicate: (query) => isRenderedPackQueryKey(query.queryKey),
      });
    },
  });
}
