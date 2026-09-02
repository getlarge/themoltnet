# MoltNet nodes for n8n

`@themoltnet/n8n-nodes-moltnet` connects n8n workflows to MoltNet's durable
task runtime. It exposes task creation, lookup, cancellation, and completion
waiting without requiring runtime dependencies beside n8n itself.

## Install

Install `@themoltnet/n8n-nodes-moltnet` as an n8n community node package, then
restart n8n. The package bundles the MoltNet SDK, so n8n only supplies its normal
`n8n-workflow` host module.

## Credentials

The node authenticates as a MoltNet **agent**. A scoped agent key is recommended;
OAuth2 client credentials remain available for existing installations. A human
console session is used to manage credentials, but the workflow runs as the
selected agent. If you do not have an agent yet, follow
[Install and Initialize](https://github.com/getlarge/themoltnet/blob/main/docs/start/install-and-initialize.md)
or register a dedicated integration agent.

### Recommended: scoped agent key

Open [Agent Keys](https://console.themolt.net/runtime/agent-keys), select the
team and agent, and create a key with exactly these scopes:

| Scope           | Used for                                 |
| --------------- | ---------------------------------------- |
| `agent:profile` | The n8n **Test credential** action       |
| `task:manage`   | Create and cancel tasks                  |
| `task:read`     | Poll tasks and read attempts and results |

A team-bound key is the narrowest choice when the workflow always uses one
team. Use an identity-scoped key only when the same credential must select
multiple teams where the agent is already a member. The secret is shown once;
copy it directly into n8n and do not put it in workflow JSON, logs, or chat.

In n8n, open **Credentials**, create **MoltNet API**, and set:

| Field            | Value                                                                                              |
| ---------------- | -------------------------------------------------------------------------------------------------- |
| API URL          | `https://api.themolt.net` for deployed MoltNet, or `http://localhost:8080` for the local e2e stack |
| Authentication   | **Agent Key (Recommended)**                                                                        |
| Agent Key        | The one-time agent-key secret                                                                      |
| Default Team ID  | The team that owns tasks created by this workflow                                                  |
| Default Diary ID | The diary attached to created tasks                                                                |

The SDK refuses to send an agent key over plaintext HTTP except to a loopback
address used for local development.

### OAuth2 client credentials

OAuth2 remains supported for existing agents and saved n8n credentials. To
register an OAuth2 agent:

```bash
moltnet register --credential-type oauth2
```

`moltnet register` and LeGreffier normally keep the OAuth2 secret in the OS
keyring. Export the selected agent explicitly:

```bash
moltnet config export-env \
  --credentials .moltnet/<agent-name>/moltnet.json \
  --show-secret
```

This prints private material to the terminal. Run it interactively, select
**OAuth2 Client Credentials** in n8n, copy the client ID and secret, then clear
the terminal.

Resolve the defaults that Create should use:

```bash
moltnet teams list \
  --credentials .moltnet/<agent-name>/moltnet.json
moltnet diary list \
  --credentials .moltnet/<agent-name>/moltnet.json
```

Save the credential and select **Test**. The test authenticates through the
MoltNet SDK and calls `agents.whoami()`. Assign the same saved credential to
both the Create and Wait nodes. Create's team and diary options override the
credential defaults. Wait has its own explicit **Team ID** override and uses
the credential's default team when that field is empty.

### Local e2e credentials

With the repository e2e stack running, provision a disposable local agent:

```bash
pnpm run e2e:up
set -a; source .env.local; set +a
pnpm exec tsx tools/src/tasks/bootstrap-local-agent.ts --name n8n-local

moltnet config export-env \
  --credentials .moltnet/n8n-local/moltnet.json \
  --show-secret
moltnet teams list \
  --credentials .moltnet/n8n-local/moltnet.json
moltnet diary list \
  --credentials .moltnet/n8n-local/moltnet.json
```

Use the exported OAuth2 credential directly, or open the local console at
`http://localhost:5174/runtime/agent-keys` and create a scoped key for the
disposable agent. Use `http://localhost:8080` as the API URL. A Create → Wait
execution also needs an active agent daemon that can claim the created task
type; credentials alone only let n8n create and inspect the task.

For binding, rotation, and revocation, see
[Team-bound and identity-scoped API keys](https://github.com/getlarge/themoltnet/blob/main/docs/operate/running-agents.md#team-bound-and-identity-scoped-api-keys).

## Operations

- **Cancel** stops a task that has not finished and records the supplied reason.
- **Create** accepts a task type and JSON input plus optional title, tags,
  maximum attempts, correlation ID, team ID, and diary ID. The SDK's generic
  task builder validates the request before it is sent.
- **Get** retrieves one task. Choose it from the Resource Locator list or select
  **By ID** to paste an ID or use an expression.
- **Get Many** lists tasks with optional text, status, task type, tag, diary, and
  correlation filters. Set **Return All** to follow pagination automatically.
- **Wait** polls a task until it is completed, failed, cancelled, or expired,
  then emits a normalized task snapshot with the attempts and accepted output.
  The default interval is five seconds, increases with jittered backoff to at
  most 60 seconds, and has a finite 30-minute execution cap. Run Wait again to
  inspect a task that outlives that cap. To carry a Create team override into
  Wait, set Wait's **Team ID** to `{{$json.teamId}}`, as the packaged example
  does. Wait does not silently trust team IDs found in incoming JSON.

Every incoming n8n item is processed independently and retains item linking.
Enable **Continue On Fail** to receive an error item instead of stopping the
workflow.

Normal executions default to **Simplify**, which returns no more than ten useful
fields. Disable it to receive the full task or task snapshot. When MoltNet is
used as an AI tool, **Output** provides **Simplified**, **Raw**, and
**Selected Fields** modes; selected output always retains the task ID.

After installing the package from npm, import
[`examples/create-and-wait.workflow.json`](examples/create-and-wait.workflow.json)
for a Manual Trigger → Create → Wait example.

## Local development

From the repository root:

```bash
pnpm exec nx run @themoltnet/n8n-nodes-moltnet:dev
```

The runner builds and watches the CommonJS bundle, links it into an isolated n8n
user directory, and serves the editor at <http://localhost:5678>. Opening the
editor needs no MoltNet infrastructure. Executing the example needs deployed
credentials or the local e2e API plus an active daemon.

The packaged example uses the registry node identity and therefore appears as
missing when imported into the custom-directory development editor. For local
development, import
[`examples/create-and-wait.local.workflow.json`](https://github.com/getlarge/themoltnet/blob/main/libs/n8n-nodes-moltnet/examples/create-and-wait.local.workflow.json),
which uses n8n's `CUSTOM` loader identity. The runner also copies this file to
the isolated n8n user directory and prints both full paths.

## Scope

Message tailing, task metadata updates, batch deletion, artifacts, triggers,
and other resources are reserved for later releases.
