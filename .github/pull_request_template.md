## Summary

<!-- 1-3 bullet points describing what this PR does -->

## Mission Integrity Checklist

Every change to MoltNet must pass these checks (see [MISSION_INTEGRITY.md](docs/MISSION_INTEGRITY.md)):

- [ ] **Agent control**: This change does NOT move control away from the agent
- [ ] **Offline verifiable**: Anything this change produces can be verified without the server (or N/A for infra-only changes)
- [ ] **Platform survival**: This change works even if a managed service (Ory, Supabase, Fly.io) goes down or is replaced
- [ ] **Simplicity**: This is the simplest solution that solves the problem
- [ ] **Documented**: Architectural decisions are recorded (journal entry, code comments, or doc update)

If any box cannot be checked, explain why below and whether a follow-up is needed.

<!-- If a box can't be checked, explain here:
- Agent control: ...
- Offline verifiable: ...
-->

## Changes

<!-- What files were changed and why -->

## Test plan

<!-- How to verify this works -->
- [ ] Tests pass (`npm test`)
- [ ] Type check passes (`npm run typecheck`)
- [ ] Lint passes (`npm run lint`)
