# lint-staged

lint-staged is a powerful pre-commit hook tool that runs tasks like formatters, linters, and other code quality tools exclusively on git-staged files. It makes commits faster and more reliable by avoiding the need to run tasks on entire codebases and ensures only quality code enters your repository.

## Package Information

- **Package Name**: lint-staged
- **Package Type**: npm
- **Language**: JavaScript (ESM)
- **Installation**: `npm install --save-dev lint-staged`
- **Node.js**: >=18.12.0

## Core Imports

```javascript
import lintStaged from 'lint-staged';
```

## Basic Usage

Most commonly used via npm scripts or git hooks:

```json
{
  "lint-staged": {
    "*.js": ["eslint --fix", "prettier --write"],
    "*.{json,md}": ["prettier --write"]
  },
  "scripts": {
    "precommit": "lint-staged"
  }
}
```

Direct programmatic usage:

```javascript
import lintStaged from 'lint-staged';

const success = await lintStaged({
  config: {
    '*.js': 'eslint --fix',
    '*.json': 'prettier --write',
  },
  quiet: false,
  verbose: true,
});

console.log(success ? 'All tasks passed!' : 'Some tasks failed');
```

## Architecture

lint-staged operates through several key components:

- **Git Integration**: Automatically detects staged files using git commands
- **Configuration System**: Supports multiple config formats (package.json, config files, programmatic)
- **Task Execution**: Runs commands against matched files with glob patterns
- **State Management**: Creates git stashes as backups and handles rollbacks on failures
- **Parallel Processing**: Executes multiple tasks concurrently for performance
- **File Chunking**: Handles large file sets by splitting into manageable chunks

## Capabilities

### Programmatic API

The main `lintStaged()` function for integrating lint-staged into Node.js applications and custom tooling.

```javascript { .api }
function lintStaged(options?: Options, logger?: Logger): Promise<boolean>;

interface Options {
  allowEmpty?: boolean;
  concurrent?: boolean | number;
  config?: Configuration;
  configPath?: string;
  cwd?: string;
  debug?: boolean;
  diff?: string;
  diffFilter?: string;
  maxArgLength?: number;
  quiet?: boolean;
  relative?: boolean;
  shell?: boolean | string;
  stash?: boolean;
  hidePartiallyStaged?: boolean;
  verbose?: boolean;
}
```

[Programmatic API](./programmatic-api.md)

### Command Line Interface

Complete CLI tool with comprehensive options for various workflow needs and CI/CD integration.

```bash { .api }
lint-staged [options]

# Common options:
--config [path]              # Path to configuration file
--quiet                      # Disable output
--verbose                    # Show all task output
--debug                      # Enable debug logging
--allow-empty               # Allow empty commits when tasks revert changes
--no-stash                  # Disable backup stash
--concurrent <number>        # Control task concurrency
--diff [string]             # Override git diff command
--cwd [path]                # Set working directory
```

[Command Line Interface](./cli.md)

## Types

```javascript { .api }
type Configuration =
  | Record<string, string | FunctionTask | (string | FunctionTask)[]>
  | FunctionTask;

type SyncFunctionTask = (stagedFileNames: string[]) => string | string[];
type AsyncFunctionTask = (stagedFileNames: string[]) => Promise<string | string[]>;
type FunctionTask = SyncFunctionTask | AsyncFunctionTask;

interface Logger {
  log: (...params: any) => void;
  warn: (...params: any) => void;
  error: (...params: any) => void;
}
```
