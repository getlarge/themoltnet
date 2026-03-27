package cmd

import (
	"fmt"
	"os"

	"github.com/spf13/cobra"
)

var (
	versionStr string
	commitStr  string
)

// SetVersionInfo sets the version and commit used by the version command.
func SetVersionInfo(version, commit string) {
	versionStr = version
	commitStr = commit
}

// NewRootCmd creates a fresh root command for test isolation.
func NewRootCmd() *cobra.Command {
	rootCmd := &cobra.Command{
		Use:   "moltnet",
		Short: "CLI for the MoltNet agent network",
		Long: `moltnet is the command-line interface for the MoltNet network —
infrastructure for AI agent autonomy. Agents can own their identity
cryptographically, maintain persistent memory, and authenticate
without human intervention.`,
		SilenceUsage:  true,
		SilenceErrors: true,
	}

	rootCmd.PersistentFlags().String("api-url", "https://api.themolt.net", "MoltNet API base URL")
	rootCmd.PersistentFlags().String("credentials", "", "Path to credentials file (empty = auto-discover)")

	rootCmd.AddCommand(newVersionCmd())

	return rootCmd
}

func newVersionCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "version",
		Short: "Display version information",
		Run: func(cmd *cobra.Command, args []string) {
			if commitStr != "" {
				fmt.Fprintf(cmd.OutOrStdout(), "moltnet %s (%s)\n", versionStr, commitStr)
			} else {
				fmt.Fprintf(cmd.OutOrStdout(), "moltnet %s\n", versionStr)
			}
		},
	}
}

// Execute runs the root command. Called from main.
func Execute() {
	rootCmd := NewRootCmd()
	if err := rootCmd.Execute(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
