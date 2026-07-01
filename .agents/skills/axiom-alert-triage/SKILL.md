---
name: axiom-alert-triage
description: Investigate MoltNet Axiom monitor alerts. Use when a task receives an Axiom alert webhook, telemetry evidence artifact, or needs to query Axiom logs, traces, or metrics during incident triage.
license: Apache-2.0
---

# Axiom Alert Triage

Use this skill when an Axiom monitor alert triggers a MoltNet task or when a
task receives an artifact produced from an Axiom alert.

## Goal

Produce actionable triage, not generic alert narration. The output should let a
human or follow-up agent decide whether this is a real incident, known issue,
monitor noise, or needs more evidence.

## Inputs to expect

- Raw Axiom webhook payload.
- Monitor id, name, state/action, threshold, value, time window, and query.
- Dataset names: `moltnet` and `moltnet-metrics`.
- Monitor definitions from `infra/axiom/monitors/*.json` when available.
- Optional dashboard or Axiom query links.
- Optional telemetry evidence artifact from an upstream parser task.

## Triage workflow

1. Classify the monitor family:
   - 5xx errors
   - latency regression
   - event loop pressure
   - memory pressure
   - auth/client noise
   - unknown
2. Read the matching monitor JSON from `infra/axiom/monitors/` when the task
   has repo access. Treat its `description`, query, threshold, and grouping as
   the primary alert contract.
3. Pick the telemetry surface:
   - logs/traces in `moltnet` for errors, routes, trace ids, task ids, and
     exception context;
   - metrics in `moltnet-metrics` for latency, event loop, memory, and request
     volume.
4. Query the smallest window around the alert first. Include the exact query
   text in the artifact or report.
5. Correlate by stable dimensions:
   - `service.name`
   - `resource.deployment.environment`
   - `attributes.route`
   - `attributes.http.response.status_code`
   - `trace_id`
   - `attributes.taskId`
   - `attributes.teamId`
   - `attributes.diaryId`
6. Compare the evidence with the MoltNet repo, open GitHub issues, and MoltNet
   diary entries when the task has access to those tools.
7. Mark the result as one of:
   - `actionable`
   - `known_issue`
   - `monitor_noise`
   - `needs_more_data`

## Evidence artifact shape

Parser/enricher tasks should write a JSON artifact titled
`telemetry-evidence`:

```json
{
  "alert": {
    "action": "triggered|resolved|unknown",
    "monitorId": "string",
    "monitorName": "string",
    "severity": "critical|warning|info|unknown",
    "startedAt": "ISO-8601",
    "window": { "end": "ISO-8601 or relative", "start": "ISO-8601 or relative" }
  },
  "classification": {
    "environment": "string|null",
    "family": "5xx|latency|event_loop|memory|auth_noise|unknown",
    "route": "string|null",
    "service": "string|null"
  },
  "correlations": {
    "diaryIds": [],
    "taskIds": [],
    "teamIds": [],
    "traceIds": []
  },
  "gaps": [],
  "queries": [
    {
      "dataset": "moltnet or moltnet-metrics",
      "language": "APL or MPL",
      "query": "string",
      "rows": [],
      "summary": "string"
    }
  ],
  "version": 1
}
```

## Triage report shape

Codebase triage tasks should write a JSON artifact titled `triage-report`:

```json
{
  "codeReferences": [],
  "confidence": "high|medium|low",
  "evidence": [],
  "gaps": [],
  "recommendedAction": "string",
  "relatedEntries": [],
  "relatedIssues": [],
  "summary": "string",
  "suspectedSubsystems": [],
  "verdict": "actionable|known_issue|monitor_noise|needs_more_data",
  "version": 1
}
```

## Judge rubric

The judge should fail or request revision if:

- the report does not cite the telemetry evidence artifact;
- code references are missing for an actionable code hypothesis;
- monitor noise is claimed without explaining the noisy dimension;
- severity is asserted without threshold/value/window context;
- related issues or diary entries were not checked when tooling was available;
- recommended action is not concrete.

## Safety

- Do not patch code or mutate Axiom config from triage unless explicitly asked.
- Do not create GitHub issues or comments unless the task explicitly requests
  that write action.
- Treat tokens, webhook secrets, and Axiom API keys as secrets. Do not include
  them in artifacts.
