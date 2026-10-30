# Workflows

Applications use MoltNet tasks to give agents bounded work and collect their
results. A workflow decides when to create each task; agents claim and run the
tasks under their runtime profiles. See
[Tasks and Runtime](../use/tasks-and-runtime.md) for the task lifecycle.

These GitHub Actions are complete examples. Follow each link for the workflow
and its setup:

| Workflow        | What its MoltNet tasks do                                                                                                       | Setup                                                                                                        |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Adaptive review | Classify a pull request, then review only the lanes it needs: docs, tests, conventions, security, blast radius, and complexity. | [Adaptive review README](https://github.com/getlarge/themoltnet/blob/main/libs/adaptive-review/README.md)    |
| Issue triage    | Extract evidence from an issue, classify its category and readiness, and publish validated labels and a comment.                | [Issue triage workflow](https://github.com/getlarge/themoltnet/blob/main/.github/workflows/issue-triage.yml) |

GitHub Actions prepares each request and starts MoltNet tasks. Agent daemon
workers execute them, and the workflow publishes a validated result to the pull
request or issue.

When an issue opens or its title or body changes, a lightweight job creates or
refreshes one instruction comment. A repository owner, member, or collaborator
can reply with exactly `/triage` to run the model tasks. Other comments and
issue edits do not run models. An operator can also dispatch the workflow with
`gh workflow run issue-triage.yml -f issue=123 --repo getlarge/themoltnet`.
There is no scheduled sweep. The concurrency group allows one issue triage job
at a time and queues later jobs. Each triage run uses at most two sequential
model tasks: evidence extraction, then classification when
`MOLTNET_ISSUE_CLASSIFIER_ENABLED=true` in the `legreffier` environment and
`TYPESAFE_API_KEY` is available there. The triage job times out after 20
minutes; each model task has one attempt.

The workflow applies `needs-spec` or `ready-for-agent` from validated evidence.
The classifier may also add `bug`, `enhancement`, or `question` when its
selected category has at least 85% probability and the issue has no category
label. It never assigns a label for `other` or replaces an existing category
label.

After publication, triage reads the issue again and retains an
`issue-triage-<repository-id>-<issue>-<run-id>-<run-attempt>` artifact for 14
days only if the issue remains open with the same title and body. Its versioned
JSON receipt contains that exact issue snapshot and content digest, validated
quality judgments, the accepted extraction attempt and input/output CIDs, and
the producer run identity and checked-out source revision. Classification, when
available, is advisory. CIDs are recorded from the authenticated task API; this
producer does not independently recompute them.

The receipt records issue quality, not human approval or a rubric proving an
implementation is correct. A downstream reviewer must validate the producer
workflow and artifact provenance, accepted task identity, and current issue
content before using it. Labels, comment markers, and a supplied JSON file alone
are not authority. Adaptive review does not consume these receipts yet; this
handoff allows that integration without requiring a MoltNet delivery task.
