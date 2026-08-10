//
// Pack and rendered-pack queries.
//
// IMPORTANT: `usePackWithEntries` requests `expand=entries`, which inlines the
// full body of every entry in the pack. It is for ONE pack at a time. Never
// call it across a diary's packs to compute coverage or entry membership —
// see issue #1854 items 1 and 2 for why that was cut.
//
// Mirrors the shape of `../diaries/hooks.ts`, which is the house pattern.

import {
  type ProblemDetails,
  updateContextPack,
  updateRenderedPack,
} from '@moltnet/api-client';
import {
  getContextPackByIdOptions,
  getContextPackProvenanceByIdOptions,
  getRenderedPackByIdOptions,
  listDiaryPacksOptions,
  listDiaryRenderedPacksOptions,
} from '@moltnet/api-client/query';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { getApiClient } from '../api.js';
import { defaultUnpinExpiry } from './decay.js';

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

/**
 * Body for a pin toggle.
 *
 * Unpinning MUST carry an `expiresAt`: both update handlers reject
 * `pinned: false` without one (`apps/rest-api/src/routes/packs.ts`,
 * `.../rendered-packs.ts`). Pinning must NOT carry one — the same handlers
 * reject `expiresAt` against an already-pinned row, and the repository clears
 * the column on pin. Callers pass only `pinned`; the window is derived here so
 * no call site can get the combination wrong.
 */
function pinBody(pinned: boolean, expiresAt?: string) {
  return pinned
    ? { pinned: true }
    : { pinned: false, expiresAt: expiresAt ?? defaultUnpinExpiry(new Date()) };
}

/**
 * Carries the API's `ProblemDetails` through to the caller.
 *
 * Throwing the raw problem object is not an option (`only-throw-error`), and
 * flattening it to `new Error('Failed to update pin state')` would lose the
 * distinction between forbidden, not-found and validation failures — which is
 * exactly what a pin control needs to render a useful message.
 */
export class PackMutationError extends Error {
  readonly problem: ProblemDetails;

  constructor(problem: ProblemDetails) {
    super(problem.title ?? problem.detail ?? 'Failed to update pin state');
    this.name = 'PackMutationError';
    this.problem = problem;
  }
}

/**
 * The generated `updateContextPackMutation` helper is deliberately not used:
 * it exposes the raw `{ path, body }` shape at every call site, which would
 * let a caller send the rejected `pinned: false` payload above. The wrapper
 * keeps the invariant in one place. Errors surface as `PackMutationError`, so
 * callers keep the `ProblemDetails` rather than a flattened generic Error.
 */
export function usePinPack() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      packId,
      pinned,
      expiresAt,
    }: {
      packId: string;
      pinned: boolean;
      expiresAt?: string;
    }) => {
      const { data, error } = await updateContextPack({
        client: client(),
        path: { id: packId },
        body: pinBody(pinned, expiresAt),
      });
      if (error) throw new PackMutationError(error as ProblemDetails);
      if (!data) throw new Error('Failed to update pin state');
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
      expiresAt,
    }: {
      renderedPackId: string;
      pinned: boolean;
      expiresAt?: string;
    }) => {
      const { data, error } = await updateRenderedPack({
        client: client(),
        path: { id: renderedPackId },
        body: pinBody(pinned, expiresAt),
      });
      if (error) throw new PackMutationError(error as ProblemDetails);
      if (!data) throw new Error('Failed to update pin state');
      return data;
    },
    onSuccess: () => {
      // Also invalidates context-pack queries: `GET /packs` accepts
      // `includeRendered=true` and embeds rendered packs in that response, so
      // a rendered-pack pin leaves those combined rows stale otherwise.
      void queryClient.invalidateQueries({
        predicate: (query) =>
          isRenderedPackQueryKey(query.queryKey) ||
          isPackQueryKey(query.queryKey),
      });
    },
  });
}
