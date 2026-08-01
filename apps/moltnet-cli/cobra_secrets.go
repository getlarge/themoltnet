package main

import "github.com/spf13/cobra"

func newSecretsCmd() *cobra.Command {
	secretsCmd := &cobra.Command{
		Use:   "secrets",
		Short: "Protect local agent secret material",
	}
	guardCmd := &cobra.Command{
		Use:   "guard",
		Short: "Deny agent tool access to protected credential material",
		Long: `Read a Claude Code, Codex, or normalized OpenCode PreToolUse payload
from stdin. Malformed payloads and internal failures deny access so secret
protection never silently disappears in an activated editor session.`,
		Args: cobra.NoArgs,
		RunE: func(cmd *cobra.Command, args []string) error {
			return runSecretsGuardCmd(cmd.InOrStdin(), cmd.OutOrStdout())
		},
	}
	secretsCmd.AddCommand(guardCmd)
	return secretsCmd
}
