package main

import "github.com/spf13/cobra"

func newGitHubCmd() *cobra.Command {
	githubCmd := &cobra.Command{
		Use:   "github",
		Short: "GitHub App integration commands",
	}

	// setup subcommand
	var setupName, setupAppSlug string
	setupCmd := &cobra.Command{
		Use:   "setup",
		Short: "One-command setup for GitHub App git identity",
		Example: `  moltnet github setup --app-slug my-bot
  moltnet github setup --app-slug my-bot --name "My Bot"`,
		RunE: func(cmd *cobra.Command, args []string) error {
			credPath, _ := cmd.Flags().GetString("credentials")
			return runGitHubSetupCmd(credPath, setupName, setupAppSlug)
		},
	}
	setupCmd.Flags().StringVar(&setupName, "name", "", "git committer name (default: app name from GitHub)")
	setupCmd.Flags().StringVar(&setupAppSlug, "app-slug", "", "GitHub App slug")

	// credential-helper subcommand
	credHelperCmd := &cobra.Command{
		Use:     "credential-helper [get|store|erase]",
		Short:   "Git credential helper for GitHub App authentication",
		Example: `  moltnet github credential-helper`,
		Args:    cobra.MaximumNArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			if len(args) == 1 && args[0] != "get" {
				return nil
			}
			credPath, _ := cmd.Flags().GetString("credentials")
			return runGitHubCredentialHelperIOCmd(credPath, cmd.InOrStdin(), cmd.OutOrStdout())
		},
	}

	// token subcommand
	var tokenRepository string
	tokenCmd := &cobra.Command{
		Use:   "token",
		Short: "Print a GitHub App installation access token",
		Example: `  GH_TOKEN=$(moltnet github token) gh pr create ...
  moltnet github token --credentials /path/to/moltnet.json`,
		RunE: func(cmd *cobra.Command, args []string) error {
			credPath, _ := cmd.Flags().GetString("credentials")
			return runGitHubTokenForRepositoryCmd(credPath, tokenRepository)
		},
	}
	tokenCmd.Flags().StringVarP(&tokenRepository, "repo", "R", "", "Target GitHub repository (owner/repo); defaults to the current Git remote")

	guardCmd := &cobra.Command{
		Use:   "guard",
		Short: "Guard GitHub CLI authorship in agent hook commands",
		Long: `Read a Claude Code or Codex PreToolUse hook payload from stdin and
deny write-capable gh commands that would silently use human credentials.

Malformed input and commands outside a selected MoltNet identity context are
allowed silently. Set MOLTNET_GITHUB_GUARD_STRICT=1 to deny writes when App
permission state is unavailable, or MOLTNET_GITHUB_GUARD=off to disable the
guard for an emergency editor session.`,
		Example: `  # .claude/settings.json or .codex/hooks.json
  moltnet github guard`,
		Args: cobra.NoArgs,
		RunE: func(cmd *cobra.Command, args []string) error {
			return runGitHubGuardCmd(cmd.InOrStdin(), cmd.OutOrStdout())
		},
	}

	// exec subcommand — first-class agent-authored GitHub execution path
	// (issue #1824). Resolves credentials from the selected central identity, mints
	// a command-scoped App token, and runs exactly one `gh` child process.
	execCmd := &cobra.Command{
		Use:   "exec -- gh <command>",
		Short: "Run a gh command with a command-scoped MoltNet GitHub App token",
		Long: `Resolve the selected central identity document, mint a GitHub App installation token, and execute exactly one child
gh process with GH_TOKEN set to that token.

The token is never printed or persisted. If token minting fails, the command
fails closed — gh never falls back to the human login. stdin, stdout, stderr,
and the child exit code are preserved.

The guard recognises this wrapper structurally, so token provenance no longer
requires proving shell variables, dirname, or conditionals.`,
		Example: `  moltnet github exec -- gh issue edit 1788 --body-file issue.md
  moltnet github exec -- gh pr create --title "Fix" --body "Description"`,
		RunE: func(cmd *cobra.Command, args []string) error {
			credPath, _ := cmd.Flags().GetString("credentials")
			return runGitHubExecCmd(credPath, args, cmd.InOrStdin(), cmd.OutOrStdout(), cmd.ErrOrStderr())
		},
	}

	keyCmd := &cobra.Command{
		Use:   "key",
		Short: "Manage the stored GitHub App private key",
	}
	var replacePrivateKey string
	replaceCmd := &cobra.Command{
		Use:   "replace",
		Short: "Store a new GitHub App private key in place of the current one",
		Long: `Replace the GitHub App private key that github.private_key_ref resolves to.

The new key is first checked against GitHub: it must sign a JWT that GitHub
accepts for the configured App. Only then is it written, in place, to the
provider entry the reference already names; moltnet.json is not changed.
Cached installation tokens are cleared so the next command uses the new key.

Rotate a key by generating a new one in the GitHub App settings, running this
command, confirming 'moltnet github token' works, and then deleting the old
key on GitHub. Deleting it there is what invalidates every other copy.`,
		Example: `  moltnet github key replace --private-key ~/Downloads/my-app.2026-09-27.private-key.pem`,
		Args:    cobra.NoArgs,
		RunE: func(cmd *cobra.Command, args []string) error {
			credPath, _ := cmd.Flags().GetString("credentials")
			return runGitHubKeyReplaceCmd(cmd.Context(), cmd.OutOrStdout(), cmd.ErrOrStderr(), githubKeyReplaceOpts{
				credentialsPath: credPath,
				privateKeyPath:  replacePrivateKey,
			})
		},
	}
	replaceCmd.Flags().StringVar(&replacePrivateKey, "private-key", "", "Path to the new PEM private key downloaded from the GitHub App settings")
	_ = replaceCmd.MarkFlagRequired("private-key")
	keyCmd.AddCommand(replaceCmd)

	githubCmd.AddCommand(setupCmd, credHelperCmd, tokenCmd, guardCmd, execCmd, keyCmd)
	return githubCmd
}
