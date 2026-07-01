// Shared upsert engine for the committed Axiom config (dashboards + monitors).
//
// Both infra/otlp/dashboards/apply.mjs and infra/otlp/monitors/apply.mjs are
// thin wrappers that hand a `config` to `run()` here. The committed *.json
// files are the source of truth; this module makes applying them idempotent.
//
// Zero runtime dependencies: relies on Node 18+ global `fetch` and the std lib.
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

/**
 * @typedef {Object} ResourcePlan
 * @property {'update'|'create'} action
 * @property {string} name        Human label for logging.
 * @property {string} [id]        Existing resource id (update only).
 * @property {string} method      HTTP verb for the apply request.
 * @property {string} path        API path (relative to API_URL) for the apply request.
 * @property {unknown} body       JSON body to send.
 *
 * @typedef {Object} ApplyConfig
 * @property {string} label                       Plural noun for messages, e.g. "dashboard".
 * @property {string} scope                        Token scope hint for the missing-token error.
 * @property {(args: {def: object, file: string}) => string} nameOf  Extract the display name.
 * @property {(args: {defs: {def: object, file: string}[], api: ApiClient}) => Promise<ResourcePlan[]>} plan
 *           Build the per-resource apply plan (existence probing happens here so each
 *           resource type can use its own strategy — GET-by-uid vs list-and-match).
 */

class HttpError extends Error {
  /** @param {number} status @param {string} url @param {string} body */
  constructor(status, url, body) {
    super(`HTTP ${status} for ${url}${body ? `: ${body}` : ''}`);
    this.status = status;
    this.url = url;
  }
}

/** Minimal Axiom REST client. Throws HttpError on non-2xx (except where the caller probes status). */
class ApiClient {
  /** @param {string} apiUrl @param {string} token */
  constructor(apiUrl, token) {
    this.apiUrl = apiUrl.replace(/\/+$/, '');
    this.headers = {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    };
  }

  /** GET and parse JSON; throws HttpError on non-2xx. */
  async getJson(path) {
    const url = `${this.apiUrl}${path}`;
    const res = await fetch(url, { headers: this.headers });
    if (!res.ok)
      throw new HttpError(res.status, url, await res.text().catch(() => ''));
    return res.json();
  }

  /** Send a JSON body; throws HttpError on non-2xx. */
  async send(method, path, body) {
    const url = `${this.apiUrl}${path}`;
    const res = await fetch(url, {
      method,
      headers: this.headers,
      body: JSON.stringify(body),
    });
    if (!res.ok)
      throw new HttpError(res.status, url, await res.text().catch(() => ''));
    return res;
  }
}

/** Read every *.json sibling of the entry script (sorted), parsed to {def, file}. */
async function loadDefinitions(scriptDir) {
  const entries = await readdir(scriptDir);
  const files = entries.filter((f) => f.endsWith('.json')).sort();
  return Promise.all(
    files.map(async (file) => {
      const full = join(scriptDir, file);
      try {
        return { def: JSON.parse(await readFile(full, 'utf8')), file: full };
      } catch (err) {
        throw new Error(`Failed to parse ${full}: ${err.message}`);
      }
    }),
  );
}

/**
 * Entry point for the thin wrappers.
 * @param {ApplyConfig} config
 * @param {{ scriptUrl: string, argv?: string[], env?: NodeJS.ProcessEnv }} ctx
 */
export async function run(
  config,
  { scriptUrl, argv = process.argv.slice(2), env = process.env },
) {
  const dryRun = argv.includes('--dry-run');
  const apiUrl = env.AXIOM_API_URL || 'https://api.axiom.co';
  const token = env.AXIOM_API_TOKEN;

  if (!token) {
    console.error(`FATAL: AXIOM_API_TOKEN is not set (needs ${config.scope}).`);
    process.exitCode = 1;
    return;
  }

  const scriptDir = dirname(new URL(scriptUrl).pathname);
  const api = new ApiClient(apiUrl, token);

  let defs;
  try {
    defs = await loadDefinitions(scriptDir);
  } catch (err) {
    console.error(`FATAL: ${err.message}`);
    process.exitCode = 1;
    return;
  }

  if (defs.length === 0) {
    console.log(`No ${config.label} definitions found in ${scriptDir}.`);
    return;
  }

  let plan;
  try {
    plan = await config.plan({ defs, api });
  } catch (err) {
    // Existence probing can hit auth/permission failures up front — abort, don't half-apply.
    console.error(`FATAL: ${err.message}`);
    process.exitCode = 1;
    return;
  }

  for (const item of plan) {
    if (dryRun) {
      const what = item.action === 'update' ? `UPDATE (${item.id})` : 'CREATE';
      console.log(`[dry-run] would ${what}: ${item.name}`);
      continue;
    }

    const verb = item.action === 'update' ? 'Updating' : 'Creating';
    const idSuffix = item.id ? ` (${item.id})` : '';
    console.log(`${verb} ${config.label} '${item.name}'${idSuffix} ...`);
    try {
      await api.send(item.method, item.path, item.body);
    } catch (err) {
      console.error(
        `FATAL: failed to ${item.action} ${config.label} '${item.name}': ${err.message}`,
      );
      process.exitCode = 1;
      return;
    }
    console.log(`  done: ${item.name}`);
  }

  console.log(`All ${config.label} definitions applied.`);
}

export { ApiClient, HttpError };
