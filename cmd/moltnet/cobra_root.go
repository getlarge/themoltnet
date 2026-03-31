package main

import (
	"fmt"
	"os"

	"github.com/spf13/cobra"
)

// NewRootCmd creates a fresh root command for test isolation.
func NewRootCmd(version, commit string) *cobra.Command {
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

	rootCmd.AddCommand(newVersionCmd(version, commit))
	rootCmd.AddCommand(newInfoCmd())
	rootCmd.AddCommand(newRegisterCmd())
	rootCmd.AddCommand(newSSHKeyCmd())
	rootCmd.AddCommand(newSignCmd())
	rootCmd.AddCommand(newEncryptCmd())
	rootCmd.AddCommand(newDecryptCmd())
	rootCmd.AddCommand(newGitCmd())
	rootCmd.AddCommand(newConfigCmd())
	rootCmd.AddCommand(newGitHubCmd())
	rootCmd.AddCommand(newAgentsCmd())
	rootCmd.AddCommand(newCryptoCmd())
	rootCmd.AddCommand(newVouchCmd())
	rootCmd.AddCommand(newDiaryCmd())
	rootCmd.AddCommand(newEntryCmd())
	rootCmd.AddCommand(newPackCmd())
	rootCmd.AddCommand(newRelationsCmd())
	rootCmd.AddCommand(newCompletionCmd())
	rootCmd.AddCommand(newUseCmd())
	rootCmd.AddCommand(newEnvCmd())
	rootCmd.AddCommand(newStartCmd())

	return rootCmd
}

func newVersionCmd(version, commit string) *cobra.Command {
	return &cobra.Command{
		Use:   "version",
		Short: "Display version information",
		Run: func(cmd *cobra.Command, args []string) {
			if commit != "" {
				fmt.Fprintf(cmd.OutOrStdout(), "moltnet %s (%s)\n", version, commit)
			} else {
				fmt.Fprintf(cmd.OutOrStdout(), "moltnet %s\n", version)
			}
		},
	}
}

// Execute runs the root command. Called from main.
func Execute(version, commit string) {
	rootCmd := NewRootCmd(version, commit)
	if err := rootCmd.Execute(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
