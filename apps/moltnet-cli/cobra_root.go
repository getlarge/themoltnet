package main

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"

	"github.com/spf13/cobra"
	"golang.org/x/term"
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
		if shouldAnnouncePendingMigration(cmd) {
			// A local file read, so it runs inline rather than racing command
			// output from a goroutine.
			credPath, _ := cmd.Flags().GetString("credentials")
			if notice := pendingConfigMigrationNotice(credPath); notice != "" {
				fmt.Fprint(cmd.ErrOrStderr(), notice)
			}
		}
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

// shouldAnnouncePendingMigration gates the advisory notice to interactive use.
//
// The notice already goes to stderr, so it cannot corrupt a captured stdout —
// but that is not sufficient. Scripts that redirect with 2>&1 would fold it
// into the stream they parse, and some callers treat any stderr output as a
// failure signal. Requiring a terminal makes the notice reach the only audience
// that can act on it and keeps every pipeline, CI job and command substitution
// byte-identical to before.
//
// `migrate` is excluded because it is about to report the same thing far more
// precisely, and workspace invocations because a developer running from source
// is not the person this is for.
func shouldAnnouncePendingMigration(cmd *cobra.Command) bool {
	if isCLIWorkspaceInvocation() || cmd.Name() == "migrate" {
		return false
	}
	f, ok := cmd.ErrOrStderr().(*os.File)
	return ok && term.IsTerminal(int(f.Fd()))
}
