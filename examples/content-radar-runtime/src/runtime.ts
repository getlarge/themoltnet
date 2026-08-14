import { createPiDaemonAdapter } from '@themoltnet/agent-daemon/pi';
import {
  defineGondolinTemplate,
  definePiRuntime,
} from '@themoltnet/pi-runtime';

import { exaContents, exaSearch } from './exa-tools.js';

/**
 * The content-radar runtime.
 *
 * It adds exactly two tools to the stock Pi surface — `exa_search` and
 * `exa_contents` — because the market-sweep phase is the only phase in the
 * workflow that needs to reach outside MoltNet and the repository.
 *
 * Scope note: both tools are declared `scope: 'parent'` and execute in the
 * daemon's runtime process, not inside the Gondolin VM. The VM's `allowedHosts`
 * therefore does NOT constrain them; their egress is constrained by the tool
 * implementation itself (one fixed API origin, `redirect: 'error'`, a private-
 * address deny-list on the model-supplied URL, and bounded response reads).
 * The VM template below still matters for the scan and draft phases, which do
 * touch a repository worktree.
 */
export const runtime = definePiRuntime({
  id: 'content-radar-pi',
  version: '1',
  runtimeKind: 'content_radar_pi',
  vm: defineGondolinTemplate({
    id: 'content-radar-node-git',
    version: '1',
    snapshot: {
      setupCommands: ['apk add --no-cache git nodejs npm'],
      allowedHosts: ['dl-cdn.alpinelinux.org'],
    },
    executables: ['git', 'node', 'npm'],
  }),
  tools: [exaSearch, exaContents],
});

export default createPiDaemonAdapter(runtime);
