package main

import (
	"time"

	"github.com/spf13/cobra"
)

func newAgentsInitCmd() *cobra.Command {
	opts := agentsInitOpts{}
	cmd := &cobra.Command{
		Use:   "init",
		Short: "Register an agent and create its GitHub App identity",
		Long: `Register a repository-scoped MoltNet agent, create and install its
GitHub App, store credentials in the OS keyring, and configure signed Git
authorship. Agent-host skills and hooks are delivered by the LeGreffier plugin
and are deliberately outside this command.`,
		Example: `  moltnet agents init --name legreffier
  moltnet agents init --name legreffier --org getlarge
  moltnet agents init --name legreffier --no-open`,
		Args: cobra.NoArgs,
		RunE: func(cmd *cobra.Command, args []string) error {
			opts.apiURL, _ = cmd.Flags().GetString("api-url")
			opts.out = cmd.OutOrStdout()
			opts.errOut = cmd.ErrOrStderr()
			return runAgentsInitCmd(opts)
		},
	}
	cmd.Flags().StringVar(&opts.name, "name", "", "Agent and GitHub App name (required)")
	cmd.Flags().StringVar(&opts.org, "org", "", "GitHub organization that will own the App")
	cmd.Flags().StringVar(&opts.dir, "dir", ".", "Repository root directory")
	cmd.Flags().BoolVar(&opts.noOpen, "no-open", false, "Print browser URLs without opening them")
	cmd.Flags().DurationVar(&opts.timeout, "timeout", 5*time.Minute, "Maximum time to wait for GitHub setup")
	_ = cmd.MarkFlagRequired("name")
	return cmd
}
