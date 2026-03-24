# Commit Pipeline Planner

## Problem/Feature Description

A team building a task-extraction pipeline harvests benchmark tasks from git commit history. The pipeline groups related commits into logical tasks and uses specific markers to identify complete, verified task chains. However, the quality of extraction depends heavily on how developers shape their commits — mixed, sprawling commits produce unusable tasks.

The team needs a planning tool that takes a description of upcoming work and produces a commit plan: how to split the work into well-shaped commits, what metadata to attach, and what checks to run before pushing. The tool should also understand when work can be declared "complete" vs when it still needs verification.

## Output Specification

Create the following files:

1. `commit-planner.ts` — A TypeScript module that exports:
   - A `planCommitChain(workDescription: string, filesToChange: string[]): CommitPlan` function
   - A `CommitPlan` type with individual commit descriptions, ordering, and metadata
   - A `generateCommitMessage(commit: PlannedCommit): string` function
   - A `verificationRequired(changeType: string): string` function that returns what evidence is needed before work can be marked done

2. `pre-push-checklist.ts` — A TypeScript module that exports:
   - A `PrePushCheck` type and `runPrePushChecklist(repoState: RepoState): CheckResult[]` function that validates the repository is ready to push

3. `splitting-guide.md` — A document explaining the commit splitting philosophy, practical heuristics, and when changes should be considered verified vs merely written.

## Input Files

The following files are provided as inputs. Extract them before beginning.

=============== FILE: inputs/work-description.txt ===============
Task: Add rate limiting to the REST API

Changes needed:

1. Add a rate-limit middleware to the Fastify server (new file)
2. Add configuration schema for rate limit settings (modify existing config)
3. Write tests for the rate limiter
4. Update the OpenAPI spec to document 429 responses
5. Add a database migration for the rate_limits table
   =============== END FILE ===============
