# n8n community-node UX checklist

Source of truth: [n8n UX guidelines](https://docs.n8n.io/connect/create-nodes/build-your-node/reference/ux-guidelines/)
([Markdown](https://docs.n8n.io/connect/create-nodes/build-your-node/reference/ux-guidelines.md)).
This checklist was reconciled with the official page on 2026-09-02.

## Credentials

- Render API keys, client secrets, passwords, tokens, and other sensitive
  values as password fields.
- Include OAuth when the service exposes a suitable OAuth flow. If it is not
  applicable to the identity represented by the node, record why rather than
  silently omitting it.
- When API keys and OAuth are both supported, expose separate credential types
  and an Authentication selector on the node. Extend n8n's built-in
  `oAuth2Api` credential for OAuth instead of implementing token exchange in
  the node; keep the API-key credential focused on its bearer/header mapping.
- Provide a credential test that performs the smallest useful authenticated
  request and returns a helpful success or recovery message.

## Resources and operations

- Include common Create, Create or Update, Delete, Get, Get Many, and Update
  operations when the service supports them. This is a recommendation, not
  permission to invent unsupported behavior.
- Use the service's user-facing terminology. For example, use Cancel when tasks
  are cancellable but not deletable.
- When an operation acts on a child entity rather than the selected resource,
  name that entity in the operation.
- Use a Resource Locator whenever a user selects one existing item. Prefer
  `From List` as the default mode when listing is available, and retain a
  by-ID mode for expressions and copied identifiers.
- For Get Many operations, expose useful filters and put sorting in a dedicated
  collection below general Options when sorting is supported.
- Use n8n's prescribed descriptions for standard pagination controls:
  `Whether to return all results or only up to a given limit` for `Return All`
  and `Max number of results to return` for `Limit`.
- Do not poll a long-running remote job inside an app node. Provide a one-shot
  status or result operation, then demonstrate n8n's built-in Wait node and an
  IF loop in the example workflow so n8n can persist the paused execution.

## Output

- A delete operation returns one item containing `{ "deleted": true }`.
- If a normal operation can return more than 10 fields, add a `Simplify`
  boolean. The simplified form has at most 10 useful, preferably flattened,
  fields. Its exact description is:
  `Whether to return a simplified version of the response instead of the raw data`.
- If an AI tool operation can return more than 10 fields, use an `Output`
  option with `Simplified`, `Raw`, and `Selected Fields`. Selected Fields always
  includes the entity ID. Treat `usableAsTool: true` as requiring this review;
  document the rationale if the operation's bounded output makes it unnecessary.
- Keep the most useful and identifying fields first. Do not hide status or an
  ID needed by the next node.

## Copy

- Use Title Case for the node display name, parameter display names, dropdown
  titles, and operation `name`.
- Use sentence case for operation `action`, node and operation descriptions,
  parameter descriptions, hints, and dropdown descriptions.
- Operation `name`: omit the resource when a Resource field is directly above
  it, unless the operation acts on a different object.
- Operation `action`: omit articles, include the resource, and include the
  actual child object when relevant. Example: `Create task`, not
  `Create a task`.
- Operation `description`: include the resource, add information beyond the
  name where useful, and use plain alternative wording.
- Prefer the terminology users see in the service UI. Avoid implementation
  language such as slug, daemon, bounded backoff, terminal state, payload, or
  endpoint when plain product language works.
- Use one term consistently for each concept.
- Helpful placeholders begin with `e.g.`. Example content uses camel case when
  that convention fits the field.
- Wrap parameter and field display names in single quotation marks when copy
  refers to them.
- Start boolean descriptions with `Whether...`.

## Errors

Every user-facing execution error needs two parts:

1. A message explaining what happened.
2. A description telling the user what to change or how to continue.

Also check that:

- The message or description names the relevant parameter using its display
  name when known.
- Item-aware errors pass `itemIndex`, allowing n8n to identify the input item.
- Copy avoids generic words such as error, problem, failure, and mistake.
- API details do not replace recovery advice. Map common authentication,
  authorization, not-found, validation, rate-limit, and temporary service
  responses to a useful next action while retaining safe diagnostic context.
- Credential tests do not merely expose a raw SDK or HTTP message.
- Timeout guidance says whether to increase the timeout, run the operation
  again, or inspect the task directly.

## Manual editor check

- Light and dark icons are legible and visually consistent.
- Conditional fields appear only for the relevant resource, operation, and
  credential mode.
- Defaults produce a valid first execution or make the missing choice obvious.
- Resource Locator list and ID modes work with expressions.
- Simplified, raw, and selected output match their labels.
- Error messages are readable in the Output panel and provide a next step.
