package main

import (
	"fmt"
	"os"
	osExec "os/exec"
	"path/filepath"
	"sort"
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

	// Build environment: current env + agent env vars (agent vars override)
	env := os.Environ()
	for k, v := range vars {
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
			fmt.Fprintf(cmd.OutOrStdout(), "  %s=%s\n", k, vars[k])
		}
		return nil
	}

	// exec replaces the current process
	return syscall.Exec(targetPath, []string{target}, env)
}
