package main

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/spf13/cobra"
)

func runEnvCheckCmd(cmd *cobra.Command, identityFlag string) error {
	agentName, err := resolveIdentityAlias(identityFlag)
	if err != nil {
		return err
	}
	agentDir, err := identityDir(agentName)
	if err != nil {
		return err
	}
	envPath := filepath.Join(agentDir, "env")
	vars, err := parseEnvFile(envPath)
	if err != nil {
		return fmt.Errorf("env file not found at %s — run 'moltnet agents init --name %s'", envPath, agentName)
	}

	prefix := toEnvPrefix(agentName)
	paths := newAgentPathResolver(agentDir, agentDir, agentName)
	fmt.Fprintf(cmd.OutOrStdout(), "Checking agent %q (%s)\n\n", agentName, envPath)

	failed := false

	required := []struct {
		key       string
		checkFile bool
	}{
		{prefix + "_CLIENT_ID", false},
		{"GIT_CONFIG_GLOBAL", true},
	}
	if _, err := resolveAgentOAuth2Environment(agentDir, agentName, NewSecretProviderRegistry()); err != nil {
		fmt.Fprintf(cmd.OutOrStdout(), "✗ %s_CLIENT_SECRET → %v\n", prefix, err)
		failed = true
	} else {
		fmt.Fprintf(cmd.OutOrStdout(), "✓ %s_CLIENT_SECRET → resolved at launch\n", prefix)
	}

	for _, r := range required {
		val, ok := vars[r.key]
		if !ok || val == "" {
			fmt.Fprintf(cmd.OutOrStdout(), "✗ %s not set\n", r.key)
			failed = true
			continue
		}
		if r.checkFile {
			checkPath := paths.resolveFile(val, "")
			if _, err := os.Stat(checkPath); err != nil {
				fmt.Fprintf(cmd.OutOrStdout(), "✗ %s → %s (file not found)\n", r.key, val)
				failed = true
				continue
			}
			fmt.Fprintf(cmd.OutOrStdout(), "✓ %s → %s (exists)\n", r.key, val)
		} else {
			fmt.Fprintf(cmd.OutOrStdout(), "✓ %s\n", r.key)
		}
	}
	creds, configErr := ReadConfigFrom(filepath.Join(agentDir, "moltnet.json"))
	if configErr != nil || creds == nil || creds.GitHub == nil || creds.GitHub.AppID == "" || (creds.GitHub.PrivateKeyPath == "" && creds.GitHub.PrivateKeyRef == nil) {
		fmt.Fprintln(cmd.OutOrStdout(), "✗ GitHub App identity/private key is not configured")
		failed = true
	} else {
		fmt.Fprintln(cmd.OutOrStdout(), "✓ GitHub App identity/private key configured (installation resolves per repository)")
	}

	resolvedContext, contextErr := resolveContextBinding(agentDir, "")
	if contextErr != nil {
		fmt.Fprintf(cmd.OutOrStdout(), "✗ activation context → %v\n", contextErr)
		failed = true
	} else if resolvedContext.Binding == nil {
		// Not a failure: team and diary are optional, as they always were.
		fmt.Fprintf(cmd.OutOrStdout(), "⚠ no team/diary for %s — run 'moltnet context set' to bind this location\n", resolvedContext.Key)
	} else {
		fmt.Fprintf(cmd.OutOrStdout(), "✓ context %s → team %s, diary %s (%s)\n", resolvedContext.Key, resolvedContext.Binding.TeamID, resolvedContext.Binding.DiaryID, resolvedContext.Source)
	}

	// Authorship vars
	authorship := vars["MOLTNET_COMMIT_AUTHORSHIP"]
	if authorship == "" {
		fmt.Fprintf(cmd.OutOrStdout(), "⚠ MOLTNET_COMMIT_AUTHORSHIP not set (default: agent)\n")
	} else if authorship != "agent" && authorship != "human" && authorship != "coauthor" {
		fmt.Fprintf(cmd.OutOrStdout(), "✗ MOLTNET_COMMIT_AUTHORSHIP=%q — must be agent, human, or coauthor\n", authorship)
		failed = true
	} else {
		fmt.Fprintf(cmd.OutOrStdout(), "✓ MOLTNET_COMMIT_AUTHORSHIP=%s\n", authorship)
	}

	humanID := vars["MOLTNET_HUMAN_GIT_IDENTITY"]
	if authorship == "human" || authorship == "coauthor" {
		if humanID == "" {
			fmt.Fprintf(cmd.OutOrStdout(), "✗ MOLTNET_HUMAN_GIT_IDENTITY not set — required for %s mode\n", authorship)
			failed = true
		} else if !isValidGitIdentity(humanID) {
			fmt.Fprintf(cmd.OutOrStdout(), "⚠ MOLTNET_HUMAN_GIT_IDENTITY=%q — expected format: Name <email>\n", humanID)
		} else {
			fmt.Fprintf(cmd.OutOrStdout(), "✓ MOLTNET_HUMAN_GIT_IDENTITY=%s\n", humanID)
		}
	} else if humanID != "" {
		fmt.Fprintf(cmd.OutOrStdout(), "✓ MOLTNET_HUMAN_GIT_IDENTITY=%s\n", humanID)
	}

	fmt.Fprintln(cmd.OutOrStdout())
	if failed {
		return fmt.Errorf("some required checks failed")
	}
	fmt.Fprintln(cmd.OutOrStdout(), "All required checks passed.")
	return nil
}

// isValidGitIdentity checks if s matches the "Name <email>" format.
// The closing ">" must be the final non-whitespace character.
func isValidGitIdentity(s string) bool {
	trimmed := strings.TrimSpace(s)
	open := strings.LastIndex(trimmed, "<")
	close := strings.LastIndex(trimmed, ">")
	return open > 0 && close > open && trimmed[open-1] == ' ' && close == len(trimmed)-1
}
