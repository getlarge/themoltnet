package main

import (
	"fmt"
	"os"
	"path/filepath"

	"github.com/spf13/cobra"
)

func runUseCmd(cmd *cobra.Command, dir, agentName string) error {
	moltnetDir, err := resolveMoltnetDir(dir)
	if err != nil {
		return err
	}

	// Validate agent exists
	agentDir := filepath.Join(moltnetDir, agentName)
	if _, err := os.Stat(filepath.Join(agentDir, "moltnet.json")); err != nil {
		return fmt.Errorf("agent %q not found in %s — run 'legreffier init --name %s'", agentName, moltnetDir, agentName)
	}

	// Warn if env file is missing
	envPath := filepath.Join(agentDir, "env")
	if _, err := os.Stat(envPath); err != nil {
		fmt.Fprintf(cmd.ErrOrStderr(), "Warning: %s not found — run 'legreffier setup --name %s' to generate it\n", envPath, agentName)
	}

	// Write default-agent file
	defaultPath := filepath.Join(moltnetDir, "default-agent")
	if err := os.WriteFile(defaultPath, []byte(agentName), 0o644); err != nil {
		return fmt.Errorf("write default-agent: %w", err)
	}

	fmt.Fprintf(cmd.OutOrStdout(), "Default agent set to %q\n", agentName)
	return nil
}
