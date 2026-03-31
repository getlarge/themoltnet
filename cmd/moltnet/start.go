package main

import (
	"fmt"
	"os"
	osExec "os/exec"
	"path/filepath"
	"sort"
	"strings"
	"syscall"

	"github.com/spf13/cobra"
)

func runStartCmd(cmd *cobra.Command, dir, agentFlag, target string, dryRun bool) error {
	moltnetDir, err := resolveMoltnetDir(dir)
	if err != nil {
		return err
	}
	agentName, err := resolveAgentName(moltnetDir, agentFlag)
	if err != nil {
		return err
	}

	envPath := filepath.Join(moltnetDir, agentName, "env")
	vars, err := parseEnvFile(envPath)
	if err != nil {
		return fmt.Errorf("env file not found at %s — run 'legreffier setup --name %s'", envPath, agentName)
	}

	// Resolve target binary
	targetPath, err := osExec.LookPath(target)
	if err != nil {
		return fmt.Errorf("%q not found in PATH", target)
	}

	// Resolve relative paths in env vars against the .moltnet directory's
	// parent (repo root). This ensures paths like .moltnet/<agent>/gitconfig
	// work correctly when launched from a linked worktree where .moltnet/
	// was resolved from the main worktree.
	repoRoot := filepath.Dir(moltnetDir)
	for k, v := range vars {
		if k == "GIT_CONFIG_GLOBAL" && v != "" && !filepath.IsAbs(v) {
			vars[k] = filepath.Join(repoRoot, v)
		}
	}

	// Build environment: current env with agent env vars replacing any
	// inherited duplicates. Appending would leave stale values from a
	// previous session visible to the child process.
	envMap := make(map[string]string)
	for _, entry := range os.Environ() {
		if idx := strings.IndexByte(entry, '='); idx > 0 {
			envMap[entry[:idx]] = entry[idx+1:]
		}
	}
	for k, v := range vars {
		envMap[k] = v
	}
	env := make([]string, 0, len(envMap))
	for k, v := range envMap {
		env = append(env, k+"="+v)
	}

	if dryRun {
		fmt.Fprintf(cmd.OutOrStdout(), "Agent: %s\n", agentName)
		fmt.Fprintf(cmd.OutOrStdout(), "Target: %s (%s)\n\n", target, targetPath)
		fmt.Fprintln(cmd.OutOrStdout(), "Environment variables from env file:")
		keys := make([]string, 0, len(vars))
		for k := range vars {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		for _, k := range keys {
			v := vars[k]
			if isSecretKey(k) {
				v = "***"
			}
			fmt.Fprintf(cmd.OutOrStdout(), "  %s=%s\n", k, v)
		}
		return nil
	}

	// exec replaces the current process
	return syscall.Exec(targetPath, []string{target}, env)
}

// isSecretKey returns true for env var names that likely contain secrets.
func isSecretKey(key string) bool {
	return strings.HasSuffix(key, "_CLIENT_SECRET") ||
		strings.Contains(key, "_PRIVATE_KEY")
}
