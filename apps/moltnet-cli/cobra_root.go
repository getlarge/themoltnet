package main

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"

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

	rootCmd.PersistentFlags().String(
		"api-url",
		defaultAPIURL,
		"MoltNet API base URL (default: $MOLTNET_API_URL, credentials endpoint, or production)",
	)
	rootCmd.PersistentFlags().String("credentials", "", "Path to credentials file (empty = auto-discover)")
	rootCmd.PersistentPreRun = func(cmd *cobra.Command, args []string) {
		// Advisory and credential-free: the refresh must never delay a command.
		if cmd.Name() != "start" || isCLIWorkspaceInvocation() {
			return
		}
		go func() {
			result, err := checkCLIUpdate(context.Background(), version, false)
			if err == nil && result.UpdateAvailable {
				fmt.Fprintf(cmd.ErrOrStderr(), "A new MoltNet CLI release (%s) is available. Run: %s\n", result.Latest, result.Command)
			}
		}()
	}

	rootCmd.AddCommand(newVersionCmd(version, commit))
	rootCmd.AddCommand(newUpdateCmd(version))
	rootCmd.AddCommand(newInfoCmd())
	rootCmd.AddCommand(newRegisterCmd())
	rootCmd.AddCommand(newSSHKeyCmd())
	rootCmd.AddCommand(newCapabilityCmd())
	rootCmd.AddCommand(newSignCmd())
	rootCmd.AddCommand(newSigningRequestsCmd())
	rootCmd.AddCommand(newSigningCredentialsCmd())
	rootCmd.AddCommand(newEncryptCmd())
	rootCmd.AddCommand(newDecryptCmd())
	rootCmd.AddCommand(newGitCmd())
	rootCmd.AddCommand(newConfigCmd())
	rootCmd.AddCommand(newGitHubCmd())
	rootCmd.AddCommand(newAgentsCmd())
	rootCmd.AddCommand(newCryptoCmd())
	rootCmd.AddCommand(newDiaryCmd())
	rootCmd.AddCommand(newEntryCmd())
	rootCmd.AddCommand(newPackCmd())
	rootCmd.AddCommand(newRenderedPacksCmd())
	rootCmd.AddCommand(newRelationsCmd())
	rootCmd.AddCommand(newTeamsCmd())
	rootCmd.AddCommand(newProfileCmd())
	rootCmd.AddCommand(newTaskCmd())
	rootCmd.AddCommand(newEvalCmd())
	rootCmd.AddCommand(newCompletionCmd())
	rootCmd.AddCommand(newUseCmd())
	rootCmd.AddCommand(newEnvCmd())
	rootCmd.AddCommand(newSecretsCmd())
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
		var exitErr *exec.ExitError
		if errors.As(err, &exitErr) {
			os.Exit(exitErr.ExitCode())
		}
		os.Exit(1)
	}
}
