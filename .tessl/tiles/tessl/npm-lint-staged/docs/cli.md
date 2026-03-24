# Command Line Interface

The lint-staged CLI provides a comprehensive command-line interface for running tasks against git-staged files. It's primarily designed for use in git hooks, npm scripts, and CI/CD pipelines.

## Basic Usage

```bash { .api }
lint-staged [options]
```

## Installation and Setup

```bash
# Install as dev dependency
npm install --save-dev lint-staged

# Set up pre-commit hook (using husky)
npx husky add .husky/pre-commit "npx lint-staged"

# Or use in package.json scripts
{
  "scripts": {
    "precommit": "lint-staged"
  }
}
```

## Configuration

lint-staged automatically discovers configuration from multiple sources:

1. `package.json` "lint-staged" field
2. `.lintstagedrc` (JSON, YAML)
3. `.lintstagedrc.json`
4. `.lintstagedrc.yaml` / `.lintstagedrc.yml`
5. `.lintstagedrc.js` / `.lintstagedrc.mjs`
6. `lint-staged.config.js` / `lint-staged.config.mjs`

## CLI Options

### Core Options

**`-c, --config [path]`**

- Path to configuration file
- Use `--config -` to read configuration from stdin
- Disables automatic config discovery

**`--cwd [path]`**

- Run all tasks in specific directory instead of current
- Useful for monorepos and build scripts

**`-d, --debug`**

- Print additional debug information
- Shows git commands, file matching, and task execution details

### Task Execution Options

**`-p, --concurrent <number|boolean>`**

- Control task concurrency (default: true)
- `true`: Run tasks concurrently
- `false`: Run tasks serially
- `number`: Maximum concurrent tasks

**`-x, --shell [path]`**

- Skip parsing of tasks for better shell support
- `true`: Use default shell
- `string`: Path to specific shell

**`--max-arg-length [number]`**

- Maximum length of command-line argument string
- Automatically detected by default

### Output Options

**`-q, --quiet`**

- Disable lint-staged's own console output
- Only shows errors and task failures

**`-v, --verbose`**

- Show task output even when tasks succeed
- By default only failed output is shown

### Git Options

**`--diff [string]`**

- Override default `--staged` flag of `git diff`
- Example: `--diff "HEAD...origin/main"`
- **Implies `--no-stash`**

**`--diff-filter [string]`**

- Override default `--diff-filter=ACMR` flag of `git diff`
- Controls which file change types to include:
  - `A`: Added files
  - `C`: Copied files
  - `M`: Modified files
  - `R`: Renamed files

**`--no-stash`**

- Disable backup stash and don't revert on errors
- **Implies `--no-hide-partially-staged`**
- Use with caution as changes may be lost on task failures

**`--no-hide-partially-staged`**

- Disable hiding unstaged changes from partially staged files
- Tasks will see both staged and unstaged changes

### Commit Options

**`--allow-empty`**

- Allow empty commits when tasks revert all staged changes
- Useful when formatters might remove all changes

**`-r, --relative`**

- Pass relative filepaths to tasks instead of absolute paths
- Paths are relative to the `--cwd` directory

## Usage Examples

### Basic Usage

```bash
# Run with default configuration
lint-staged

# Run with specific config file
lint-staged --config .lintstagedrc.json

# Run with debug output
lint-staged --debug
```

### Advanced Usage

```bash
# Run tasks serially instead of concurrently
lint-staged --concurrent false

# Run with custom working directory
lint-staged --cwd /path/to/project

# Run quietly with relative paths
lint-staged --quiet --relative

# Check files between commits instead of staged files
lint-staged --diff "HEAD~1...HEAD" --no-stash
```

### CI/CD Integration

```bash
# In GitHub Actions
- name: Run lint-staged
  run: |
    npm ci
    npx lint-staged --diff "origin/main...HEAD"

# In pre-commit hook
#!/bin/sh
npx lint-staged --quiet

# In npm script with error handling
{
  "scripts": {
    "lint-staged": "lint-staged || (echo 'lint-staged failed!' && exit 1)"
  }
}
```

### Configuration Examples

**package.json:**

```json
{
  "lint-staged": {
    "*.css": "stylelint --fix",
    "*.md": "markdownlint",
    "*.{js,ts}": ["eslint --fix", "prettier --write"]
  }
}
```

**.lintstagedrc.js:**

```javascript
export default {
  '*.js': ['eslint --fix', 'prettier --write'],
  '*.{json,md}': 'prettier --write',
  '*.css': (filenames) => [
    `stylelint ${filenames.join(' ')} --fix`,
    `prettier ${filenames.join(' ')} --write`,
  ],
};
```

### Reading Configuration from stdin

```bash
# Pipe configuration to lint-staged
echo '{"*.js": "eslint --fix"}' | lint-staged --config -

# From file
cat lint-staged-config.json | lint-staged --config -
```

## Error Handling

lint-staged exits with different codes based on execution results:

- **Exit Code 0**: All tasks passed successfully
- **Exit Code 1**: Some tasks failed or other errors occurred

## Common Patterns

### Pre-commit Hook Setup

```bash
# Using husky
npm install --save-dev husky lint-staged
npx husky install
npx husky add .husky/pre-commit "npx lint-staged"
```

### Monorepo Usage

```bash
# Run in specific package directory
lint-staged --cwd packages/frontend

# With custom config per package
lint-staged --cwd packages/backend --config packages/backend/.lintstagedrc.json
```

### Gradual Adoption

```bash
# Only check files changed from main branch
lint-staged --diff "main...HEAD" --no-stash

# Test run without making changes
lint-staged --diff "HEAD~1...HEAD" --no-stash --verbose
```

## Integration with Git Hooks

lint-staged is designed to work seamlessly with git hooks:

```bash
# .husky/pre-commit
#!/usr/bin/env sh
. "$(dirname -- "$0")/_/husky.sh"

npx lint-staged

# .git/hooks/pre-commit (if not using husky)
#!/bin/sh
npx lint-staged
```

## Troubleshooting

**Configuration not found:**

```bash
lint-staged --debug  # Shows config discovery process
```

**Tasks failing:**

```bash
lint-staged --verbose  # Shows all task output
```

**Git issues:**

```bash
lint-staged --debug  # Shows git commands being executed
```

**Performance issues:**

```bash
lint-staged --concurrent false  # Run tasks serially
lint-staged --concurrent 2      # Limit concurrency
```
