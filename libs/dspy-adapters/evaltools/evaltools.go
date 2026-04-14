// Package evaltools constructs the dspy-go tool registry used by ReAct
// eval solvers. It wires the file + bash toolset from dspy-go with an
// extended environment allowlist suitable for running dev-toolchain
// commands (go generate, pnpm, cargo, etc.) inside sandboxed worktrees.
//
// See docs/superpowers/specs/2026-04-13-react-solver-tool-registry-design.md.
package evaltools

import (
	"fmt"
	"strings"
	"time"

	"github.com/XiaoConstantine/dspy-go/pkg/core"
	"github.com/XiaoConstantine/dspy-go/pkg/tools"
	"github.com/XiaoConstantine/dspy-go/pkg/tools/bash"
	"github.com/XiaoConstantine/dspy-go/pkg/tools/files"
)

// Config configures the eval tool registry.
type Config struct {
	// WorkDir is the sandboxed worktree root. Required.
	WorkDir string

	// BashTimeoutSec overrides the per-command bash timeout.
	// Zero uses the default (120s).
	BashTimeoutSec int

	// PassthroughEnv lists additional env vars to pass through to bash,
	// on top of the built-in dev toolchain list.
	PassthroughEnv []string

	// ExtraEnv provides explicit env var overrides injected into bash.
	ExtraEnv map[string]string
}

const defaultBashTimeoutSec = 120

// devToolchainEnvKeys extends the dspy-go bash tool's built-in allowlist
// (HOME, PATH, USER, LANG, SHELL, TERM, LOGNAME, TMPDIR, LC_*) with
// language toolchain paths that eval commands commonly depend on.
var devToolchainEnvKeys = []string{
	// Go
	"GOPATH", "GOROOT", "GOMODCACHE", "GOPROXY", "GONOSUMCHECK", "GOFLAGS",
	// Node.js
	"NODE_PATH", "NVM_DIR",
	// Rust
	"CARGO_HOME", "RUSTUP_HOME",
	// Python
	"VIRTUAL_ENV", "PYTHONPATH", "PYTHONHOME",
	// Ruby
	"RUBY_HOME", "GEM_HOME", "BUNDLE_PATH",
}

// DevToolchainEnvKeys returns a copy of the built-in dev toolchain
// env key list. Exported for testing and documentation.
func DevToolchainEnvKeys() []string {
	out := make([]string, len(devToolchainEnvKeys))
	copy(out, devToolchainEnvKeys)
	return out
}

// NewRegistry constructs an InMemoryToolRegistry with the standard
// eval toolset (ls, read, write, edit, bash) configured for the given
// work directory.
func NewRegistry(cfg Config) (*tools.InMemoryToolRegistry, error) {
	if strings.TrimSpace(cfg.WorkDir) == "" {
		return nil, fmt.Errorf("evaltools: Config.WorkDir is required")
	}

	timeout := time.Duration(defaultBashTimeoutSec) * time.Second
	if cfg.BashTimeoutSec > 0 {
		timeout = time.Duration(cfg.BashTimeoutSec) * time.Second
	}

	passthrough := mergePassthroughEnv(cfg.PassthroughEnv)

	allTools, err := buildToolset(cfg.WorkDir, timeout, passthrough, cfg.ExtraEnv)
	if err != nil {
		return nil, fmt.Errorf("evaltools: creating toolset: %w", err)
	}

	registry := tools.NewInMemoryToolRegistry()
	for _, tool := range allTools {
		if err := registry.Register(tool); err != nil {
			return nil, fmt.Errorf("evaltools: registering tool %q: %w", tool.Name(), err)
		}
	}
	return registry, nil
}

// buildToolset constructs file tools (ls, read, write, edit) + bash
// directly rather than via defaults.NewToolset, so we can configure
// the bash tool's ExtraEnv and PassthroughEnvKeys (which the defaults
// wrapper does not expose).
func buildToolset(workDir string, bashTimeout time.Duration, passthrough []string, extraEnv map[string]string) ([]core.Tool, error) {
	fileTools, err := files.NewToolset(files.Config{
		Root: workDir,
	})
	if err != nil {
		return nil, fmt.Errorf("creating file toolset: %w", err)
	}

	bashTool, err := bash.NewTool(bash.Config{
		Root:               fileTools.Root(),
		Timeout:            bashTimeout,
		ExtraEnv:           extraEnv,
		PassthroughEnvKeys: passthrough,
	})
	if err != nil {
		return nil, fmt.Errorf("creating bash tool: %w", err)
	}

	allTools := append([]core.Tool{}, fileTools.Tools()...)
	allTools = append(allTools, bashTool)
	return allTools, nil
}

// mergePassthroughEnv combines the built-in dev toolchain keys with
// user-supplied additions. Deduplicates, preserving order (built-ins
// first, additions appended).
func mergePassthroughEnv(additional []string) []string {
	seen := make(map[string]bool, len(devToolchainEnvKeys)+len(additional))
	result := make([]string, 0, len(devToolchainEnvKeys)+len(additional))
	for _, key := range devToolchainEnvKeys {
		if !seen[key] {
			seen[key] = true
			result = append(result, key)
		}
	}
	for _, key := range additional {
		key = strings.TrimSpace(key)
		if key != "" && !seen[key] {
			seen[key] = true
			result = append(result, key)
		}
	}
	return result
}
