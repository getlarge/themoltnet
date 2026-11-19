# One-way Ory transfer

Run `node --import tsx tools/src/ory-transfer.ts` from a pinned product checkout.
The default is a read-only plan. `--apply` copies into an empty target and
rebinds the restored application's Kratos IDs. It uses `@ory/client-fetch`.

A reviewed operator wrapper supplies JSON on stdin with `sourceUrl`,
`sourceToken`, `kratosAdminUrl`, `kratosPublicUrl`, `ketoReadUrl`, `ketoWriteUrl`,
`databaseUrl`, `databaseSystemId`, and `databaseName`. Never put credentials in
arguments or print the input. Source must be HTTPS Ory Network; target URLs and
PostgreSQL must use verified loopback tunnels to the intended host. Verify the
PostgreSQL system identifier independently before supplying it.

Before apply, quarantine target writers/ingress, stop source writes for the
final copy, retain encrypted backups, and verify matching source/target OPL.
Apply also refuses other clients connected to the target application database.
Identity schema definitions must match. Source requests are GET-only; output
contains counts and fixed phases only. Permissions are compared as complete
sets. Source drift or changed application bindings aborts the transfer.

For an isolated rehearsal only, `--rehearsal` permits source permission changes
between snapshot and readback, reporting the actual `sourceUnchanged` result.
Source identities must still stay unchanged, and target permissions must match
the copied snapshot exactly. Never promote this rehearsal copy: freeze source
writers and repeat the final transfer from a fresh database restore without
`--rehearsal`.

The released Kratos import API preserves password hashes and OIDC subjects,
but does not accept all credential types. The command rejects unsupported
credential material by default. Only after an explicit re-enrolment decision,
`--reenroll-mfa` omits those credentials and leaves affected target identities
inactive. Verify replacement authentication before reopening those accounts.
Existing inactive identities stay inactive. Sessions and Hydra client secrets
are not copied; agent recovery uses the retained signing keys after relinking.

Every source identity is copied, including identities without an application
binding. Existing stale application bindings and pending NULL bindings are
reported and retained, not silently repaired. Agent keys must match. Only
`agents.identity_id` and `humans.identity_id` are updated, together in a guarded
transaction; durable IDs and keys stay unchanged.

On failure, keep the target quarantined. There is no automatic reset, rollback
of Ory writes, or resume. For a disposable rehearsal, explicitly prepare a new
empty target before retrying. After an uncertain database commit, inspect the
bindings before any action. Successful transfer still requires application,
permission, human-login and real-agent recovery smoke tests before admission.
Live operator procedures and target inventory are maintained privately.
