# Automated Dependency Updates with Renovate

This repository uses [Renovate](https://github.com/renovatebot/renovate) to automate dependency updates with a low-noise approach suitable for our pnpm/Nx monorepo.

## Configuration Overview

The Renovate configuration is defined in `renovate.json` at the root of the repository. Key features include:

- **Weekly schedule**: Updates are processed weekly to reduce noise
- **Grouped updates**: Related dependencies are grouped into single PRs by ecosystem
- **Auto-merging**: Safe patch updates are automatically merged after CI passes
- **Human review**: Minor updates are grouped for human review
- **Major update controls**: Major updates require explicit approval via the dependency dashboard
- **PR volume limits**: Concurrent PRs are capped to prevent overwhelming the team
- **Lockfile maintenance**: Weekly lockfile maintenance ensures consistency

## Dependency Dashboard

Renovate provides a [Dependency Dashboard](https://docs.renovatebot.com/key-concepts/dashboard/) issue that gives visibility and control over the update process. Team members can use this dashboard to approve major updates, pause updates, or manually trigger specific updates.

## Update Policies

### Patch Updates

Patch updates (e.g., `1.2.3` → `1.2.4`) are automatically merged after CI passes.

### Minor Updates

Minor updates (e.g., `1.2.3` → `1.3.0`) are grouped by ecosystem and require human review.

### Major Updates

Major updates (e.g., `1.2.3` → `2.0.0`) require explicit approval via the dependency dashboard.

## Grouping Strategy

Dependencies are grouped by ecosystem to reduce PR volume:

- Development tools (TypeScript, ESLint, Prettier, etc.)
- Nx packages
- Fastify packages
- pnpm packages
- Database tools (Drizzle ORM, etc.)

Additional groups can be added by modifying the `packageRules` in `renovate.json`.

## Configuration Customization

To customize the Renovate configuration, modify the `renovate.json` file. Common customizations include:

- Adding new package groupings
- Adjusting PR volume limits
- Modifying update schedules
- Adding package-specific rules

Refer to the [Renovate documentation](https://docs.renovatebot.com/) for detailed configuration options.
