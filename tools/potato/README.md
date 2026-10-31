# Potato operator tooling

Reusable Potato operations live here. Task-specific schemas, model rubrics,
dataset adapters and layouts belong to the project that owns the evaluation.
For search evaluation, start with [retrieval review](../../libs/retrieval-eval/potato/README.md).
Future agent-trace tasks should have their own owner and contracts; reuse these
operator commands rather than copying the search labels or import rules.

| Path                        | Responsibility                                                     |
| --------------------------- | ------------------------------------------------------------------ |
| `scripts/collaborators.py`  | Manage a closed reviewer roster without changing existing accounts |
| `scripts/mcp_connect.py`    | Connect an MCP client without putting tokens in process arguments  |
| `scripts/mcp_load_items.py` | Add immutable item batches; refuse conflicting IDs                 |
| `requirements.txt`          | Shared pinned Potato runtime and compatible MCP SDK                |
| `patches/`                  | Upstream fixes, separate from task design                          |
| `../__tests__/potato/`      | Operator regression tests                                          |

These are operator tools, not infrastructure definitions. Deployment manifests
can live under `infra` when managed there; private task directories, credentials,
inputs and annotation outputs always stay outside the repository.

## Environment and tests

Create an isolated Python environment and install `tools/potato/requirements.txt`.
Use it for both operator and task-specific commands. From the repository root:

```bash
python3 -m venv /private/potato-venv
/private/potato-venv/bin/pip install -r tools/potato/requirements.txt
export POTATO_PYTHON=/private/potato-venv/bin/python
pnpm exec nx run @moltnet/tools:test:potato
```

One Potato process owns one task directory. Separate tasks use separate ports,
URL prefixes, sessions and progress. Keep public deployments on a closed roster;
start a disposable loopback pilot before inviting reviewers. Back up the complete
task before changing its configuration, and verify saved work after restart.

## Adding collaborators

The deployed task uses a closed roster and pre-created password accounts.
Potato's dashboard does not currently create/invite those accounts. Use the
recorded deployment's SSH key through this helper; it needs no cloud API key:

```bash
python tools/potato/scripts/collaborators.py --config /private/task/config.yaml --name TASK list
python tools/potato/scripts/collaborators.py --config /private/task/config.yaml --name TASK add reviewer
python tools/potato/scripts/collaborators.py --config /private/task/config.yaml --name TASK add reviewer \
  --apply --credentials-out /private/reviewer-login.json
```

The second command is a preview. Applying briefly stops the service, preserves
existing credentials and annotations, adds the reviewer to the roster, writes
a salted password hash, synchronizes the private deploy source, and starts the
service again. The generated password is written only to the new, mode-0600
handover file. Share it directly with that reviewer. No admin role is granted.
Do not run account changes concurrently with a deployment or another account
change. Failed operations require checking service health before retrying;
the helper attempts to restore the original roster and restart the service.

The helper intentionally does not revoke accounts: revocation must also handle
already-issued browser sessions, not merely remove a roster row.

## Task administration

Potato's `/admin` dashboard describes one task, not all processes on the host.
Use that task's URL prefix for its annotation page, dashboard and labeling engine.
Instances counts saved annotations, not approvals; Questions describes form
fields, not a global search-query collection. Agreement needs overlapping
judgments from multiple reviewers. Model calls and engine acceptance are not
human review or measured accuracy by themselves.

The admin API key, reviewer password and MCP token are distinct credentials.
Set a stable `POTATO_ADMIN_API_KEY` in the private service environment and store
it in the operator vault. Give collaborators reviewer accounts, not the admin
key. Keep machine annotators separately attributed and scope their writes to
those accounts. Publication is a separate explicit action after reviewing an
export; anonymizing reviewers does not sanitize task content.

## Agent access through MCP

Potato exposes a token-authenticated HTTP surface, bridged to stdio by
`potato mcp connect`. Start with explicit read tools:

```yaml
mcp:
  enabled: true
  tools:
    [
      get_status,
      get_progress,
      list_items,
      get_item,
      list_annotators,
      get_agreement,
    ]
  destructive: []
  audit_log: mcp_audit.jsonl
```

Issue a distinct token per agent with `potato mcp issue-token`. Inspection tools
require Potato's built-in `admin` token role; the above allowlist restricts the
surface to reads. Expanding that allowlist expands what existing admin-role
tokens can do. Store the plaintext token outside the task bundle and outside
the local authoring directory; the server retains its hash in `mcp_tokens.json`.

```bash
python tools/potato/scripts/mcp_connect.py --url https://annotation.example.org \
  --token-file /private/agent.token --root /private/annotation-authoring
```

Use that command and arguments in an MCP client's stdio server configuration.
The token is passed through the environment, not process arguments. The six
remote tools appear with the `live_` prefix alongside Potato's local authoring
tools. No annotation writes, deletion, dataset publication or assignment changes
are enabled by the configuration above.

## Loading task items

Use stable IDs supplied by the task owner. Scan or otherwise validate inputs
under that project's data policy before upload:

```bash
python tools/potato/scripts/mcp_load_items.py \
  --url https://annotation.example.org/task \
  --token-file /private/agent.token --root /private/annotation-authoring \
  --items /private/items.jsonl
```

The loader validates existing IDs before mutation, adds missing items in batches,
and can retry the same immutable batch. Changed content needs a new version or
task; it must not silently replace reviewed inputs. Enable `add_items` and the
inspection tools explicitly in the task's MCP allowlist.

## Upstream patches

See [patch maintenance](patches/README.md) for the Solo persistence fix.
