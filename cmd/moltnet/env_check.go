package main

import (
	"fmt"
	"os"
	"path/filepath"

	"github.com/spf13/cobra"
)

func runEnvCheckCmd(cmd *cobra.Command, dir, agentFlag string) error {
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

	prefix := toEnvPrefix(agentName)
	fmt.Fprintf(cmd.OutOrStdout(), "Checking agent %q (%s)\n\n", agentName, envPath)

	failed := false

	required := []struct {
		key       string
		checkFile bool
	}{
		{prefix + "_CLIENT_ID", false},
		{prefix + "_CLIENT_SECRET", false},
		{prefix + "_GITHUB_APP_ID", false},
		{prefix + "_GITHUB_APP_PRIVATE_KEY_PATH", true},
		{prefix + "_GITHUB_APP_INSTALLATION_ID", false},
		{"GIT_CONFIG_GLOBAL", true},
	}

	for _, r := range required {
		val, ok := vars[r.key]
		if !ok || val == "" {
			fmt.Fprintf(cmd.OutOrStdout(), "✗ %s not set\n", r.key)
			failed = true
			continue
		}
		if r.checkFile {
			if _, err := os.Stat(val); err != nil {
				fmt.Fprintf(cmd.OutOrStdout(), "✗ %s → %s (file not found)\n", r.key, val)
				failed = true
				continue
			}
			fmt.Fprintf(cmd.OutOrStdout(), "✓ %s → %s (exists)\n", r.key, val)
		} else {
			fmt.Fprintf(cmd.OutOrStdout(), "✓ %s\n", r.key)
		}
	}

	// Recommended vars
	recommended := []string{"MOLTNET_DIARY_ID"}
	for _, key := range recommended {
		if _, ok := vars[key]; !ok {
			fmt.Fprintf(cmd.OutOrStdout(), "⚠ %s not set (optional — skill will auto-discover from repo)\n", key)
		} else {
			fmt.Fprintf(cmd.OutOrStdout(), "✓ %s\n", key)
		}
	}

	fmt.Fprintln(cmd.OutOrStdout())
	if failed {
		return fmt.Errorf("some required checks failed")
	}
	fmt.Fprintln(cmd.OutOrStdout(), "All required checks passed.")
	return nil
}
