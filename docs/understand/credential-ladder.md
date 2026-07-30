# Credential Ladder

MoltNet issues execution credentials as a **ladder of narrowing authority**: each
rung can do less, lives shorter, and is safer to hand outward than the one above
it. The ladder lets an agent reach an external service — and MoltNet itself —
with the smallest credential the work requires, so a leak at the edge exposes one
task or one operation rather than an entire agent.

This page explains the ladder end to end: the three rungs, who mints and who
verifies each one, and how an agent safely reaches a third-party service through
an operator-deployed adapter without that adapter ever holding a long-lived key
or knowing how MoltNet signs its tokens.

For the claim-time authority that a task token is built from, see
[Tasks and Runtime → Map 5](../use/tasks-and-runtime.md#map-5-immutable-authority-and-credentials).
For the authority layers a credential sits inside (identity, Keto, sandbox, tool
policy), see [Agent Security](./agent-security.md).

## The three rungs

```mermaid
flowchart TB
    K["Agent key<br/>who + which team · lives: weeks"]
    T["Task token<br/>+ which task/attempt/lease · lives: the lease (~minutes)"]
    C["Connector token<br/>+ which operation on which resource · lives: 1–5 min"]
    K -->|"MoltNet checks the claim is real, active, leased"| T
    T -->|"MoltNet checks a durable grant for the operation + resource"| C
```

Authority narrows at every step — team → one task → one operation on one
resource — and so does lifetime. Only MoltNet's credential broker may move down a
rung; an agent never asks for scopes, claims, TTL, or an audience directly.

| Rung                | Says                                      | Minted by                                      | Verified by                       | Lifetime       | If it leaks                                |
| ------------------- | ----------------------------------------- | ---------------------------------------------- | --------------------------------- | -------------- | ------------------------------------------ |
| **Agent key**       | who + which team                          | MoltNet (on key creation)                      | MoltNet auth chokepoint           | weeks          | the whole team, until rotation             |
| **Task token**      | who + which **task / attempt / lease**    | MoltNet broker, after re-checking the claim    | MoltNet (offline, Talos JWKS)     | the task lease | one task, until the lease ends             |
| **Connector token** | which **operation** on which **resource** | MoltNet broker, after checking a durable grant | MoltNet (on the adapter's behalf) | 1–5 minutes    | one operation on one resource, for minutes |

The task token is a Talos-signed JWT whose claims pin the full attempt binding
(agent, team, task, attempt, lease, runtime profile revision, executor manifest
fingerprint, immutable policy snapshot hash). The claim contracts live in
`@themoltnet/credentials`; the broker that mints them lives in
`@themoltnet/credential-broker`.

## Relying parties: two shapes

A **relying party** is any service that acts on a MoltNet credential. There are
two shapes, and the difference is only _who verifies the token_.

### Talos-aware service

A cooperating service — a partner, one you built yourself, or a test fixture —
integrates Talos verification directly. It fetches the Talos JWKS, checks the
signature, issuer, expiry, and the namespaced MoltNet claim, and serves the
resource. This is the standard offline relying-party model: verification makes no
call back to MoltNet.

Use this when you control the receiving service and are willing to teach it about
Talos.

### Operator adapter (third-party services)

Most external services — a customer API, a SaaS you don't control — will never
verify a MoltNet token. For these, an **operator deploys an adapter**: a
product-specific service that holds the upstream credential, translates a named
operation into a real upstream call, and defers all MoltNet-credential
verification back to MoltNet.

The adapter is **Talos-agnostic by design**. It never learns how MoltNet signs
tokens and never holds a MoltNet-issued signing key. This is the architecture the
rest of this page describes.

## Operator adapter architecture

Five trust zones, each holding only what it must:

```mermaid
flowchart LR
    subgraph Sandbox["Agent sandbox (Gondolin)"]
      M["model + host tools<br/>data and canonical IDs only —<br/>never a credential"]
    end
    subgraph Daemon["Daemon supervisor (host process)"]
      D["holds the agent key and the<br/>task token, in memory only"]
    end
    subgraph MoltNet["MoltNet core"]
      B["credential broker + authorize API<br/>knows Talos · holds Talos admin key<br/>product-neutral · no upstream code"]
    end
    subgraph Adapter["Operator adapter"]
      G["product-specific egress service<br/>holds the upstream secret<br/>Talos-agnostic"]
    end
    subgraph Ext["External service"]
      S["third-party API"]
    end
    M -->|"host tool call"| D
    D -->|"task token → mint"| B
    B -.->|connector token| D
    D -->|connector token| G
    G -->|"OAuth2 (Hydra) + connector token"| B
    B -.->|allow / deny| G
    G -->|upstream secret| S
```

Three rules make this safe and keep MoltNet product-neutral:

1. **MoltNet never makes an outbound call to the adapter.** The adapter (and the
   daemon) are clients of MoltNet; MoltNet is only ever a resource server. This
   keeps MoltNet out of the data path and free of any per-product egress
   configuration or server-side request-forgery surface.
2. **MoltNet is the sole Talos verifier.** The adapter forwards the credential to
   MoltNet's authorize endpoint and receives an allow/deny. It never verifies a
   Talos token itself, so it never needs to know Talos exists.
3. **The adapter only ever holds the narrow connector token.** The task token
   stays inside the daemon↔MoltNet boundary; the daemon exchanges it for a
   connector token bound to a single operation and resource _before_ calling the
   adapter. A compromised adapter can therefore replay only that one operation on
   that one resource, for the token's short life — never the task's whole grant
   surface.

### What each party knows

| Knows…                                               |       MoltNet core       |  Operator adapter   | External service |
| ---------------------------------------------------- | :----------------------: | :-----------------: | :--------------: |
| Talos (JWKS, admin key, derivation)                  |       ✅ only here       |         ❌          |        ❌        |
| task / lease / grant authorization                   |            ✅            |         ❌          |        ❌        |
| connector vocabulary (operations, resource patterns) |   ✅ _declared to it_    | ✅ _implements it_  |        ❌        |
| upstream URL / API shape / auth                      |            ❌            |         ✅          |    ✅ (is it)    |
| the upstream secret                                  |            ❌            |   ✅ **holds it**   |   validates it   |
| how to reach + trust the adapter                     | ✅ routing metadata only | ✅ its own identity |        ❌        |

MoltNet knows a connector's **declared vocabulary** (which operations and
resource patterns exist, for authorization) and the adapter's **service
identity** — never the upstream URL, the upstream API shape, or the upstream
secret. Translating `read_measurements` into a real HTTP call is the adapter's
job alone. No product-specific or customer code runs inside MoltNet or inside the
agent sandbox. MoltNet may store the adapter's own endpoint as routing metadata
it returns to the daemon so the daemon knows where to send the connector token,
but MoltNet never calls the adapter itself.

### Two issuers, cleanly split

The adapter authenticates to MoltNet with **OAuth2 (Ory Hydra)** — the same
`client_credentials` primitive MoltNet already uses — not with a Talos token and
not with mutual TLS.

| Issuer             | Purpose                                                                     | Verified by                           | Crosses to the adapter?                 |
| ------------------ | --------------------------------------------------------------------------- | ------------------------------------- | --------------------------------------- |
| **Talos**          | the attenuation ladder: agent key → task token → connector token            | **MoltNet only**                      | never — stays inside MoltNet's boundary |
| **Hydra (OAuth2)** | service identity: "this caller is the registered adapter for connector _X_" | MoltNet, as an OAuth2 resource server | this is the adapter's own credential    |

Talos is the attenuation primitive; Hydra is the service-to-service identity
primitive. They do not overlap. The adapter lives entirely in Hydra-land.

### Registration and invocation

An operator registers a connector through MoltNet, which provisions the Hydra
OAuth2 client on the operator's behalf — the operator configures a connector, not
raw Hydra:

```text
operator ─▶ POST /connectors          { operations: [read_measurements], resource: "sensor-*" }
            └ MoltNet provisions a Hydra OAuth2 client, returns client_id / secret
operator ─▶ POST /connectors/{id}/grants { team, operation, resource }   (durable, in Keto)
```

At runtime MoltNet stays a pure authority and makes no outbound call:

```mermaid
sequenceDiagram
    participant Host as Daemon host tool
    participant MoltNet as MoltNet
    participant Adapter as Operator adapter
    participant Ext as External service
    Host->>MoltNet: task token + {connector, operation, resource}
    Note over MoltNet: verify task token (Talos) → agent/team/task/lease<br/>check durable grant + live lease
    MoltNet-->>Host: connector token — binds {operation, resource}, short TTL
    Host->>Adapter: connector token
    Adapter->>MoltNet: OAuth2 (Hydra) + connector token
    Note over MoltNet: verify adapter's OAuth2 client is bound to the connector<br/>verify connector token (Talos) + live lease/grant
    MoltNet-->>Adapter: allow { operation, resource, agentId, teamId, taskId } — no secrets
    Adapter->>Ext: call for exactly {operation, resource}, with the upstream secret
    Ext-->>Adapter: result
    Adapter-->>Host: result (data only — no token, no secret)
```

The daemon — not the adapter — exchanges the task token for the connector token,
so the adapter only ever handles a credential scoped to a single operation and
resource. The `allow` echoes the exact `{operation, resource}` it authorized, and
the adapter must execute only that. The model receives only the data: it never
sees a token or an upstream secret, and the host tool it calls accepts canonical
structured IDs only — no URLs, headers, shell fragments, or credentials.

### Boundaries and failure modes

- **Credentials are visible only to the daemon supervisor.** The agent key and
  the task token live in the daemon's process memory, never in the sandboxed
  workload: the model and its tools receive data and canonical structured IDs
  only. This isolation is the ladder's load-bearing wall — if the workload could
  read the daemon's memory or environment, every rung would collapse into the
  agent key.
- **The adapter only ever holds the connector token.** The task token never leaves
  the daemon↔MoltNet boundary, so a compromised adapter can replay only a single
  operation on a single resource for the token's short life — not the task's whole
  grant surface.
- **A credential is honored only in its own scope.** MoltNet accepts a task token
  only after asserting it is a task-kind credential bound to the live attempt, on
  its task-scoped routes — never as general agent authority. The same holds for a
  connector token and its connector; an adapter's OAuth2 client bound to one
  connector cannot authorize another connector's operations.
- **The adapter is trusted for its own upstream.** It holds the real upstream
  secret, so a compromised adapter is a full compromise of _that connector's_
  upstream access. The ladder bounds the agent's reach, not the adapter↔upstream
  edge — that is the operator's responsibility: upstream-side least privilege,
  adapter isolation, and an operator-internal-only adapter endpoint.
- **Authorization and issuance fail closed, which couples availability.** If the
  evidence sink cannot persist an issuance event, or the authorize path is
  unavailable, no credential is issued and the work stops rather than proceeding
  unauthorized. The issuance and authorize paths are availability-critical.
- **Both happy and unhappy paths are proven end to end.** Tests must show a valid
  claim/grant/lease issues and honors the credential, _and_ that each failure —
  wrong claimant, team, task, attempt, connector, operation, resource, inactive or
  lost lease, revoked parent, unbound adapter client, missing or mismatched policy
  snapshot, or Talos outage — is denied fail-closed with a stable, low-cardinality
  reason and no secret in logs or evidence.

## What exists today

- **Rungs 1 → 2 are being delivered** in
  [#1768](https://github.com/getlarge/themoltnet/issues/1768): the task-credential
  endpoint, broker wiring, canonical task claims, the daemon exchange, and two
  relying-party consumers — MoltNet verifying its own task token on task-scoped
  routes, and a Talos-aware external-service fixture.
- **Rung 3 — the connector token, durable connector grants, and the operator
  adapter contract** — is tracked in
  [#1775](https://github.com/getlarge/themoltnet/issues/1775) so the north star
  stays visible while #1768 lands the task-token foundation.

::: info Boundaries
Talos issues and verifies; Keto owns durable relationships; MoltNet owns claim
construction, grant checks, and the audit trail; the runtime profile and Gondolin
own filesystem, process, and network confinement; the operator adapter owns the
upstream call. Authorization and issuance fail closed. A derived token stays valid
until its deliberately short expiry even after the parent key is revoked — new
derivations stop immediately, which is why every rung is short-lived.
:::
