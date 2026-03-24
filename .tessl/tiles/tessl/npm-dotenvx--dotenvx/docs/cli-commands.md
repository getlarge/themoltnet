# CLI Commands

Command-line interface providing all library functionality plus additional tools for cross-platform environment variable management, git integration, and development workflow automation.

## Installation & Usage

```bash
# Global installation
npm install -g @dotenvx/dotenvx
# or
curl -sfS https://dotenvx.sh | sh

# Usage
dotenvx [command] [options]
```

## Core Commands

### run

Run a command with environment variables loaded from .env files.

```bash { .api }
dotenvx run [options] -- <command>

Options:
  -f, --env-file <paths...>     path(s) to your env file(s) (default: [".env"])
  -fv, --env-vault-file <paths...>  path(s) to your .env.vault file(s)
  -o, --overload                override existing env variables
  --convention <name>           load a .env convention (available: nextjs, flow)
```

**Usage Examples:**

```bash
# Run node app with .env loaded
dotenvx run -- node index.js

# Run with specific .env file
dotenvx run -f .env.production -- node server.js

# Run with multiple .env files (priority order)
dotenvx run -f .env.local -f .env -- npm start

# Run with overload (override existing env vars)
dotenvx run --overload -- python app.py

# Run with convention
dotenvx run --convention nextjs -- npm run dev

# Run any language/command
dotenvx run -- python manage.py runserver
dotenvx run -- rails server
dotenvx run -- go run main.go
dotenvx run -- ./my-binary
```

### get

Get environment variable value(s) from .env files.

```bash { .api }
dotenvx get [key] [options]

Options:
  -f, --env-file <paths...>     path(s) to your env file(s) (default: [".env"])
  -fv, --env-vault-file <paths...>  path(s) to your .env.vault file(s)
  -o, --overload                override existing env variables
  --convention <name>           load a .env convention
  -a, --all                     return all env vars
  --format <format>             return format (default: "default", options: "default", "shell", "eval")
  -pp, --pretty-print           pretty print output
```

**Usage Examples:**

```bash
# Get specific variable
dotenvx get API_KEY

# Get from specific file
dotenvx get DATABASE_URL -f .env.production

# Get all variables
dotenvx get --all

# Get all in shell format
dotenvx get --all --format shell
# Output: API_KEY=secret123 DB_URL=localhost

# Get all in eval format
dotenvx get --all --format eval
# Output: API_KEY=secret123
#         DB_URL=localhost

# Pretty print all variables
dotenvx get --all --pretty-print
```

### set

Set environment variable in .env files.

```bash { .api }
dotenvx set <key> <value> [options]

Options:
  -f, --env-file <paths...>     path(s) to your env file(s) (default: [".env"])
  --convention <name>           set a .env convention
  -e, --encrypt                 encrypt the set value (default: true)
  -p, --plain                   store value as plain text
```

**Usage Examples:**

```bash
# Set encrypted variable (default)
dotenvx set API_KEY secret123

# Set in specific file
dotenvx set DATABASE_URL postgres://... -f .env.production

# Set in multiple files
dotenvx set SHARED_SECRET secret -f .env.development -f .env.staging

# Set as plain text
dotenvx set PUBLIC_URL https://api.com --plain

# Set with convention
dotenvx set NEXT_PUBLIC_API_URL https://api.com --convention nextjs
```

### encrypt

Encrypt .env files or specific keys.

```bash { .api }
dotenvx encrypt [key] [options]

Options:
  -f, --env-file <paths...>     path(s) to your env file(s) (default: [".env"])
```

**Usage Examples:**

```bash
# Encrypt entire .env file
dotenvx encrypt

# Encrypt specific key
dotenvx encrypt SECRET_KEY

# Encrypt specific file
dotenvx encrypt -f .env.production

# Encrypt multiple files
dotenvx encrypt -f .env.development -f .env.production
```

### decrypt

Decrypt .env files or specific keys.

```bash { .api }
dotenvx decrypt [key] [options]

Options:
  -f, --env-file <paths...>     path(s) to your env file(s) (default: [".env"])
```

**Usage Examples:**

```bash
# Decrypt entire .env file
dotenvx decrypt

# Decrypt specific key
dotenvx decrypt SECRET_KEY

# Decrypt specific file
dotenvx decrypt -f .env.production
```

### keypair

Generate public/private keypair for encryption.

```bash { .api }
dotenvx keypair [options]

Options:
  -f, --env-file <paths...>     path(s) to your env file(s) (default: [".env"])
```

**Usage Examples:**

```bash
# Generate keypair for .env
dotenvx keypair

# Generate keypair for specific file
dotenvx keypair -f .env.production

# Generate keypairs for multiple files
dotenvx keypair -f .env.development -f .env.production
```

### ls

List .env files in a tree structure.

```bash { .api }
dotenvx ls [directory] [options]

Options:
  -f, --env-file <filenames...>     path(s) to your env file(s) (default: [".env*"])
  -ef, --exclude-env-file <excludeFilenames...>  path(s) to exclude
```

**Usage Examples:**

```bash
# List all .env files in current directory
dotenvx ls

# List from specific directory
dotenvx ls ./config

# List with custom pattern
dotenvx ls -f "*.environment"

# List with exclusions
dotenvx ls -f ".env*" -ef ".env.example"
```

### rotate

Rotate encryption keys.

```bash { .api }
dotenvx rotate [options]

Options:
  -f, --env-file <paths...>     path(s) to your env file(s) (default: [".env"])
```

**Usage Examples:**

```bash
# Rotate keys for .env
dotenvx rotate

# Rotate keys for specific file
dotenvx rotate -f .env.production
```

## Development Workflow Commands

### prebuild

Prevent .env files from being included in Docker builds.

```bash { .api }
dotenvx prebuild [directory] [options]
```

**Usage Examples:**

```bash
# Setup prebuild for current directory
dotenvx prebuild

# Setup for specific directory
dotenvx prebuild ./docker-app
```

This command modifies build configurations to exclude .env files from Docker images.

### precommit

Prevent .env files from being committed to version control.

```bash { .api }
dotenvx precommit [directory] [options]

Options:
  -i, --install     install to .git/hooks/pre-commit
```

**Usage Examples:**

```bash
# Setup precommit hooks
dotenvx precommit

# Install as git pre-commit hook
dotenvx precommit --install

# Setup for specific directory
dotenvx precommit ./my-project
```

## Extension Commands (ext)

The `ext` command provides access to extended functionality and plugins.

### ext ls

Enhanced file listing with tree structure.

```bash { .api }
dotenvx ext ls [directory] [options]

Options:
  -f, --env-file <filenames...>     path(s) to your env file(s) (default: [".env*"])
  -ef, --exclude-env-file <excludeFilenames...>  path(s) to exclude
```

### ext genexample

Generate .env.example files.

```bash { .api }
dotenvx ext genexample [directory] [options]

Options:
  -f, --env-file <paths...>     path(s) to your env file(s) (default: [".env"])
```

**Usage Examples:**

```bash
# Generate .env.example from .env
dotenvx ext genexample

# Generate from specific file
dotenvx ext genexample -f .env.production

# Generate in specific directory
dotenvx ext genexample ./config
```

### ext gitignore

Append patterns to .gitignore, .dockerignore, .npmignore, and .vercelignore.

```bash { .api }
dotenvx ext gitignore [options]

Options:
  --pattern <patterns...>     pattern(s) to gitignore (default: [".env*"])
```

**Usage Examples:**

```bash
# Add .env* to ignore files
dotenvx ext gitignore

# Add custom patterns
dotenvx ext gitignore --pattern ".env.local" --pattern "*.key"
```

### ext prebuild

Extended prebuild functionality.

```bash { .api }
dotenvx ext prebuild [directory]
```

### ext precommit

Extended precommit functionality.

```bash { .api }
dotenvx ext precommit [directory] [options]

Options:
  -i, --install     install to .git/hooks/pre-commit
```

### ext scan

Scan for leaked secrets in files.

```bash { .api }
dotenvx ext scan
```

**Usage Examples:**

```bash
# Scan current directory for secrets
dotenvx ext scan
```

### ext vault

Manage .env.vault files (dynamic extension).

```bash { .api }
dotenvx ext vault [command] [options]
```

This extension provides additional vault file management capabilities.

## Global Options

All commands support these global options:

```bash { .api }
Options:
  -l, --log-level <level>     set log level (default: "info")
  -q, --quiet                 sets log level to error
  -v, --verbose               sets log level to verbose
  -d, --debug                 sets log level to debug
  -h, --help                  display help for command
```

## Cross-Platform Usage

dotenvx works with any language or framework:

```bash
# Node.js
dotenvx run -- node server.js
dotenvx run -- npm start

# Python
dotenvx run -- python app.py
dotenvx run -- flask run

# Ruby
dotenvx run -- ruby app.rb
dotenvx run -- rails server

# Go
dotenvx run -- go run main.go

# Rust
dotenvx run -- cargo run

# PHP
dotenvx run -- php index.php

# Any executable
dotenvx run -- ./my-binary
dotenvx run -- java -jar app.jar
```
