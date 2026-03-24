# Eval Harness Subprocess Configuration

## Problem/Feature Description

A team runs automated evaluations of AI agents by spawning Claude Code as a subprocess in isolated git worktrees. The eval harness has been producing score=0 on every run — all traces show `toolCallCount=0`, meaning the subprocesses are launching but immediately exiting without doing any work. The team has debugged this before and knows there are specific environment configuration steps required to make nested Claude Code sessions work correctly.

Your task is to implement the `getRuntimeEnv()` function for the eval harness. This function is called just before spawning each Claude Code subprocess and returns the environment variables to pass to the child process. The function should start from the current `process.env` and apply the necessary modifications to avoid the known failure modes for nested Claude Code sessions.

Also implement `createWorktreeConfig()` — a function that returns the configuration object for setting up each eval worktree. The worktree setup must avoid certain failure modes related to hooks and package installation.

Write both functions in `eval-harness-utils.ts`, along with a `KNOWN_ISSUES.md` documenting the failure modes that motivated each configuration decision.

## Output Specification

- `eval-harness-utils.ts` — implements `getRuntimeEnv()` and `createWorktreeConfig()`
- `KNOWN_ISSUES.md` — documents the failure modes addressed by each configuration choice
