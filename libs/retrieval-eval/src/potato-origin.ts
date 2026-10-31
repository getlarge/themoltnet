/** Potato's ordinary JSONL export attaches this to submitted human answers. */
export interface HumanEngineRequest {
  purpose: string;
  inclusion_prob: number | null;
  visibility: 'blind' | 'shown';
  split: string;
  request_id: number;
}
export function humanEngineRequest(
  row: Record<string, unknown>,
  schema: string,
): HumanEngineRequest | undefined {
  const origin = row.annotator_origin;
  if (
    (origin !== undefined &&
      (!origin ||
        typeof origin !== 'object' ||
        !('kind' in origin) ||
        origin.kind !== 'human')) ||
    (row.label_origin !== undefined && row.label_origin !== 'human')
  )
    throw new Error('Only human annotations can be imported');
  if (row.engine_request === undefined) return undefined;
  const requests = row.engine_request;
  if (
    !requests ||
    typeof requests !== 'object' ||
    Array.isArray(requests) ||
    !(schema in requests)
  )
    throw new Error('Invalid human engine provenance');
  const raw = (requests as Record<string, unknown>)[schema];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    throw new Error('Invalid human engine provenance');
  const r = raw as HumanEngineRequest;
  if (
    ![
      'calibration',
      'certification',
      'verify',
      'resolve',
      'audit',
      'adjudicate',
      'gold',
      'distribution',
      'organic',
      'assist',
    ].includes(r.purpose) ||
    !['blind', 'shown'].includes(r.visibility) ||
    !['dev', 'cert', 'audit', 'none'].includes(r.split) ||
    !Number.isSafeInteger(r.request_id) ||
    r.request_id < 1 ||
    (r.inclusion_prob !== null &&
      (typeof r.inclusion_prob !== 'number' ||
        !Number.isFinite(r.inclusion_prob) ||
        r.inclusion_prob < 0 ||
        r.inclusion_prob > 1))
  )
    throw new Error('Invalid human engine provenance');
  return {
    purpose: r.purpose,
    visibility: r.visibility,
    split: r.split,
    request_id: r.request_id,
    inclusion_prob: r.inclusion_prob,
  };
}
