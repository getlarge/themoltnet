/**
 * Recover the chain's `correlationId` from anchors written by the
 * daemon during a previous fulfill on the same PR.
 *
 * Resolution order (PR-context only — issue-context has no prior chain
 * by definition and just generates a fresh UUID):
 *   1. Branch name    — `moltnet/<id>/<slug>` on the PR head ref
 *   2. Commit trailer — `Moltnet-Correlation-Id: <id>` in any of the
 *                       PR's commits (signed → tamper-evident)
 *   3. PR body marker — `<!-- moltnet-correlation: <id> -->`
 *
 * Once recovered, the caller can hit `GET /tasks?correlationId=<id>`
 * to fetch the rest of the chain — that filter exists in
 * ListTasksQuerySchema. There is no URL→correlation lookup; we never
 * need one because anchor sources 1–3 carry the id directly on the
 * GitHub-side artefacts the bot can already see.
 *
 * If none match, generates a fresh UUID — caller should treat that as
 * "start of a new chain".
 */

const BRANCH_RE = /^moltnet\/([0-9a-f-]{36})\//i;
const TRAILER_RE = /^Moltnet-Correlation-Id:\s*([0-9a-f-]{36})\s*$/im;
const MARKER_RE = /<!--\s*moltnet-correlation:\s*([0-9a-f-]{36})\s*-->/i;

export interface PrCoords {
  owner: string;
  repo: string;
  number: number;
}

export interface ResolveInput {
  contextType: 'issue' | 'pr';
  referenceUrl: string;
  /** Required when contextType==='pr'; ignored otherwise. */
  pr?: PrCoords;
}

export interface ResolveDeps {
  gh: {
    getPrHeadRef(pr: PrCoords): Promise<string | null>;
    getPrCommitMessages(pr: PrCoords): Promise<string[]>;
    getPrBody(pr: PrCoords): Promise<string | null>;
  };
  randomUUID: () => string;
  logger: {
    info: (msg: string, data?: object) => void;
    warn: (msg: string, data?: object) => void;
  };
}

export async function resolveCorrelation(
  input: ResolveInput,
  deps: ResolveDeps,
): Promise<string> {
  if (input.contextType === 'pr' && input.pr) {
    // 1. Branch name
    const headRef = await deps.gh.getPrHeadRef(input.pr).catch(() => null);
    const m1 = headRef?.match(BRANCH_RE);
    if (m1) {
      deps.logger.info('resolveCorrelation: branch hit', { source: 'branch' });
      return m1[1];
    }

    // 2. Commit trailer
    const commits = await deps.gh
      .getPrCommitMessages(input.pr)
      .catch(() => [] as string[]);
    for (const c of commits) {
      const m = c.match(TRAILER_RE);
      if (m) {
        deps.logger.info('resolveCorrelation: trailer hit', {
          source: 'trailer',
        });
        return m[1];
      }
    }

    // 3. PR body marker
    const body = await deps.gh.getPrBody(input.pr).catch(() => null);
    const m3 = body?.match(MARKER_RE);
    if (m3) {
      deps.logger.info('resolveCorrelation: body hit', { source: 'body' });
      return m3[1];
    }
  }

  const fresh = deps.randomUUID();
  deps.logger.info('resolveCorrelation: fresh', {
    source: 'fresh',
    correlationId: fresh,
  });
  return fresh;
}
