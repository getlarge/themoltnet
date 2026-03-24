# DBOS-Backed Job Processing Service Setup

## Problem/Feature Description

The MoltNet platform needs a new background processing service called `JobProcessor` that handles asynchronous content analysis tasks. When a user submits a batch of documents for analysis, the service should persist the job record to the database and then dispatch durable workflows that fan out the analysis work. The service needs to be resilient — if the process crashes mid-run, incomplete workflows must resume automatically.

The engineering team has already adopted DBOS for durable workflow execution throughout the platform. Your job is to wire up the service entrypoint correctly. The team has been bitten before by incorrect initialization sequences and by mixing DBOS workflow calls inside database transactions, so they want a clean reference implementation that gets the bootstrapping right.

In addition to the main service, implement a `dispatchAnalysisJobs` handler function that receives a list of document IDs, saves a job record to the database within a transaction, and then kicks off the per-document analysis workflows after the transaction completes.

## Output Specification

Produce the following files:

- `job-processor.ts` — the service entrypoint with DBOS initialization
- `dispatch-handler.ts` — the `dispatchAnalysisJobs` handler function
- `analysis-workflow.ts` — a stub DBOS workflow that processes a single document (can be a stub, but must follow DBOS workflow/step conventions)

Include comments explaining any sequencing decisions you make.
