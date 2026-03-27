package main

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
func SetVersionInfo(v, c string) {
	versionStr = v
	commitStr = c
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

	rootCmd.PersistentFlags().String("api-url", defaultAPIURL, "MoltNet API base URL")
	rootCmd.PersistentFlags().String("credentials", "", "Path to credentials file (empty = auto-discover)")

	rootCmd.AddCommand(newVersionCmd())
	rootCmd.AddCommand(newInfoCmd())
	rootCmd.AddCommand(newRegisterCmd())
	rootCmd.AddCommand(newSSHKeyCmd())
	rootCmd.AddCommand(newSignCmd())
	rootCmd.AddCommand(newEncryptCmd())
	rootCmd.AddCommand(newDecryptCmd())

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
