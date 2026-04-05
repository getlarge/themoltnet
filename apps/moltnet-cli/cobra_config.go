package main

import "github.com/spf13/cobra"

func newConfigCmd() *cobra.Command {
	configCmd := &cobra.Command{
		Use:   "config",
		Short: "Configuration management commands",
	}

	var dryRun bool
	repairCmd := &cobra.Command{
		Use:   "repair",
		Short: "Validate and repair a MoltNet config file",
		Example: `  moltnet config repair
  moltnet config repair --dry-run`,
		RunE: func(cmd *cobra.Command, args []string) error {
			credPath, _ := cmd.Flags().GetString("credentials")
			return runConfigRepairCmd(credPath, dryRun)
		},
	}
	repairCmd.Flags().BoolVar(&dryRun, "dry-run", false, "report issues without fixing")

	initFromEnvCmd := &cobra.Command{
		Use:   "init-from-env",
		Short: "Reconstruct agent config from environment variables",
		Long: `Reconstruct .moltnet/<agent>/ directory from environment variables.
Designed for ephemeral environments (CI, Claude Code web) where
legreffier init cannot run interactively.

Required env vars:
  MOLTNET_IDENTITY_ID, MOLTNET_CLIENT_ID, MOLTNET_CLIENT_SECRET,
  MOLTNET_PUBLIC_KEY, MOLTNET_PRIVATE_KEY, MOLTNET_FINGERPRINT

Optional env vars:
  MOLTNET_API_URL (default: https://api.themolt.net)
  MOLTNET_REGISTERED_AT (default: now)
  MOLTNET_GITHUB_APP_ID, MOLTNET_GITHUB_APP_SLUG,
  MOLTNET_GITHUB_APP_INSTALLATION_ID, MOLTNET_GITHUB_APP_PRIVATE_KEY`,
		Example: `  # Set env vars, then run:
  moltnet config init-from-env --agent legreffier
  moltnet config init-from-env --agent legreffier --skip-git`,
		RunE: func(cmd *cobra.Command, args []string) error {
			dir, _ := cmd.Flags().GetString("dir")
			agent, _ := cmd.Flags().GetString("agent")
			skipGit, _ := cmd.Flags().GetBool("skip-git")
			return runConfigInitFromEnvCmd(dir, agent, skipGit)
		},
	}
	initFromEnvCmd.Flags().String("agent", "", "Agent name (required)")
	_ = initFromEnvCmd.MarkFlagRequired("agent")
	initFromEnvCmd.Flags().String("dir", ".", "Repository root directory")
	initFromEnvCmd.Flags().Bool("skip-git", false, "Skip git signing setup")

	configCmd.AddCommand(repairCmd)
	configCmd.AddCommand(initFromEnvCmd)
	return configCmd
}
