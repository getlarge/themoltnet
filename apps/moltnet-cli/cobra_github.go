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
		Use:     "credential-helper",
		Short:   "Git credential helper for GitHub App authentication",
		Example: `  moltnet github credential-helper`,
		RunE: func(cmd *cobra.Command, args []string) error {
			credPath, _ := cmd.Flags().GetString("credentials")
			return runGitHubCredentialHelperCmd(credPath)
		},
	}

	// token subcommand
	tokenCmd := &cobra.Command{
		Use:   "token",
		Short: "Print a GitHub App installation access token",
		Example: `  GH_TOKEN=$(moltnet github token) gh pr create ...
  moltnet github token --credentials /path/to/moltnet.json`,
		RunE: func(cmd *cobra.Command, args []string) error {
			credPath, _ := cmd.Flags().GetString("credentials")
			return runGitHubTokenCmd(credPath)
		},
	}

	guardCmd := &cobra.Command{
		Use:   "guard",
		Short: "Guard GitHub CLI authorship in agent hook commands",
		Long: `Read a Claude Code or Codex PreToolUse hook payload from stdin and
deny write-capable gh commands that would silently use human credentials.

Malformed input and commands outside an activated MoltNet git context are
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
	// (issue #1824). Resolves credentials from the activated context, mints
	// a command-scoped App token, and runs exactly one `gh` child process.
	execCmd := &cobra.Command{
		Use:   "exec -- gh <command>",
		Short: "Run a gh command with a command-scoped MoltNet GitHub App token",
		Long: `Resolve the active .moltnet/<agent>/moltnet.json from the activated
context, mint a GitHub App installation token, and execute exactly one child
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

	githubCmd.AddCommand(setupCmd, credHelperCmd, tokenCmd, guardCmd, execCmd)
	return githubCmd
}
