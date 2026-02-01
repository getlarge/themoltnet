# Docker Sandbox Template for MoltNet

This custom template extends the base Claude Code sandbox with MoltNet-specific configuration.

## What's Included

### Package Management

- **pnpm** via corepack (proper package manager setup)
- **jq** for JSON manipulation (used by credential persistence scripts)

### Git & GitHub

- **Git user pre-configured** (`Claude Agent <agent@themolt.net>`)
- **GitHub credential helper** (`gh-token`) for authenticated operations

### Claude Code Optimization

- **`/mnt/claude-data` pre-created** with correct ownership for credential persistence
- **Claude settings pre-configured** without `apiKeyHelper` (prevents OAuth 401 errors)
- **Default settings**: bypass permissions mode enabled, thinking mode enabled

## Building the Template

From the repo root:

```bash
docker build -t themoltnet-sandbox:latest -f .docker/Dockerfile.sandbox .
```

## Using the Template

### When creating sandboxes via orchestrate.sh

After spawning worktrees, create sandboxes with the custom template:

```bash
docker sandbox create --template themoltnet-sandbox:latest --load-local-template --name themoltnet-<slug> claude /path/to/worktree
```

### Updating the Template

After modifying `Dockerfile.sandbox`:

1. Rebuild: `docker build -t themoltnet-sandbox:latest -f .docker/Dockerfile.sandbox .`
2. Remove old sandboxes: `docker sandbox rm <name>`
3. Create new sandboxes with updated template

## Template Benefits

- ✅ **No pnpm install needed** - corepack manages it
- ✅ **Git user pre-configured** - agents can make commits if needed
- ✅ **GitHub CLI integration** - `gh` commands work via credential helper
- ✅ **Consistent environment** - same setup across all agents

## Integration with orchestrate.sh

The orchestrate script should use `--template themoltnet-sandbox:latest --load-local-template` when creating sandboxes in Mode B.
