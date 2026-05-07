/**
 * Recover the chain's `correlationId` from any of four anchors written
 * by the daemon during a previous fulfill on the same issue/PR.
 *
 * Resolution order:
 *   1. MoltNet API   — list tasks by reference URL, take any non-null id
 *   2. Branch name   — `moltnet/<id>/<slug>` on the PR head ref
 *   3. Commit trailer — `Moltnet-Correlation-Id: <id>` in any of the
 *                       PR's commits (signed → tamper-evident)
 *   4. PR body marker — `<!-- moltnet-correlation: <id> -->`
 *
 * If none match, generates a fresh UUID — caller should treat that as
 * "start of a new chain".
 *
 * Issue-context calls (no PR yet) only consult anchor #1.
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
  moltnet: {
    findCorrelationByReference(url: string): Promise<string | null>;
  };
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
  // 1. MoltNet API
  try {
    const fromApi = await deps.moltnet.findCorrelationByReference(
      input.referenceUrl,
    );
    if (fromApi) {
      deps.logger.info('resolveCorrelation: api hit', { source: 'api' });
      return fromApi;
    }
  } catch (err) {
    deps.logger.warn('resolveCorrelation: api lookup failed', {
      err: String(err),
    });
  }

  if (input.contextType === 'pr' && input.pr) {
    // 2. Branch name
    const headRef = await deps.gh.getPrHeadRef(input.pr).catch(() => null);
    const m1 = headRef?.match(BRANCH_RE);
    if (m1) {
      deps.logger.info('resolveCorrelation: branch hit', { source: 'branch' });
      return m1[1];
    }

    // 3. Commit trailer
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

    // 4. PR body marker
    const body = await deps.gh.getPrBody(input.pr).catch(() => null);
    const m4 = body?.match(MARKER_RE);
    if (m4) {
      deps.logger.info('resolveCorrelation: body hit', { source: 'body' });
      return m4[1];
    }
  }

  const fresh = deps.randomUUID();
  deps.logger.info('resolveCorrelation: fresh', {
    source: 'fresh',
    correlationId: fresh,
  });
  return fresh;
}
