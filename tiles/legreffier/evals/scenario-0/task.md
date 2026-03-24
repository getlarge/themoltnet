# Bot Identity Bootstrap Script

## Problem/Feature Description

A DevOps team is onboarding multiple AI coding agents to a monorepo. Each agent has its own cryptographic identity stored in a `.moltnet/` directory, and the repository uses a diary-based audit system. Agents may run in the main checkout or in git worktrees created for parallel work.

The team keeps losing time to agents starting work before their environment is properly configured — leading to unsigned commits, missing audit entries, and identity confusion when multiple agent identities exist. They need a robust "pre-flight" script that validates everything before an agent touches any code.

## Output Specification

Create the following files:

1. `bootstrap.sh` — A Bash script that performs the full session initialization sequence. It should determine which agent identity to use, ensure the environment is correctly configured for that identity, and fail fast with a clear error if anything is missing. The script should print a summary of the resolved session state on success.

2. `bootstrap-design.md` — A design document explaining all the steps the script performs, why each step exists, and what failure modes each step guards against. Include how the script handles edge cases like running in a worktree, multiple identities being available, or critical configuration being absent.
