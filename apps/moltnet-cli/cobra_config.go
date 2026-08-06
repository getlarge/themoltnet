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

Agent name resolution: --agent flag > MOLTNET_AGENT_NAME env var.

Required env vars:
  MOLTNET_IDENTITY_ID, MOLTNET_CLIENT_ID, MOLTNET_CLIENT_SECRET,
  MOLTNET_PUBLIC_KEY, MOLTNET_PRIVATE_KEY, MOLTNET_FINGERPRINT

Optional env vars:
  MOLTNET_AGENT_NAME (alternative to --agent flag)
  MOLTNET_API_URL (default: https://api.themolt.net)
  MOLTNET_REGISTERED_AT (default: now)
  MOLTNET_GIT_NAME (default: agent name), MOLTNET_GIT_EMAIL
  MOLTNET_GITHUB_APP_ID, MOLTNET_GITHUB_APP_SLUG,
  MOLTNET_GITHUB_APP_INSTALLATION_ID, MOLTNET_GITHUB_APP_PRIVATE_KEY`,
		Example: `  # Set env vars, then run:
  moltnet config init-from-env --agent legreffier
  moltnet config init-from-env --agent legreffier --skip-git

  # Derive agent name from MOLTNET_AGENT_NAME in env file:
  moltnet config init-from-env --env-file .env.moltnet

  # Load vars from a file and override process env:
  moltnet config init-from-env --agent legreffier --env-file .env.moltnet --override`,
		RunE: func(cmd *cobra.Command, args []string) error {
			dir, _ := cmd.Flags().GetString("dir")
			agent, _ := cmd.Flags().GetString("agent")
			skipGit, _ := cmd.Flags().GetBool("skip-git")
			envFile, _ := cmd.Flags().GetString("env-file")
			override, _ := cmd.Flags().GetBool("override")
			return runConfigInitFromEnvCmd(dir, agent, skipGit, envFile, override)
		},
	}
	initFromEnvCmd.Flags().String("agent", "", "Agent name (or set MOLTNET_AGENT_NAME)")
	initFromEnvCmd.Flags().String("dir", ".", "Repository root directory")
	initFromEnvCmd.Flags().Bool("skip-git", false, "Skip git signing setup")
	initFromEnvCmd.Flags().String("env-file", "", "Load variables from a dotenv file")
	initFromEnvCmd.Flags().Bool("override", false, "Let env-file values override process environment")

	exportEnvCmd := &cobra.Command{
		Use:   "export-env",
		Short: "Export agent config as MOLTNET_* environment variables",
		Long: `Read a moltnet.json config and print the corresponding MOLTNET_*
environment variables in dotenv format. The output is directly
usable with init-from-env --env-file.`,
		Example: `  # Print to stdout
  moltnet config export-env --credentials .moltnet/legreffier/moltnet.json

  # Write to file
  moltnet config export-env --credentials .moltnet/legreffier/moltnet.json -o .env.moltnet

  # Include GitHub App PEM content
  moltnet config export-env --credentials .moltnet/legreffier/moltnet.json --include-github-pem`,
		RunE: func(cmd *cobra.Command, args []string) error {
			credPath, _ := cmd.Flags().GetString("credentials")
			outFile, _ := cmd.Flags().GetString("output")
			includeGitHubPEM, _ := cmd.Flags().GetBool("include-github-pem")
			return runConfigExportEnvCmd(cmd.OutOrStdout(), credPath, outFile, includeGitHubPEM)
		},
	}
	exportEnvCmd.Flags().StringP("output", "o", "", "Write to file instead of stdout")
	exportEnvCmd.Flags().Bool("include-github-pem", false, "Include GitHub App private key content")

	var migrateGeneratePath string
	var migrateRunPath string
	var migrateDryRun bool
	migrateCmd := &cobra.Command{
		Use:   "migrate",
		Short: "Plan and apply configuration migrations",
		Long: `Plan and apply ordered, state-aware MoltNet configuration migrations.
Migration plans are redacted JSON bound to the exact credentials file content.
Use --generate to inspect a plan before applying it with --run.`,
		Example: `  # Apply all migrations directly
  moltnet config migrate --credentials .moltnet/legreffier/moltnet.json

  # Print the redacted plan without changing anything
  moltnet config migrate --credentials .moltnet/legreffier/moltnet.json --dry-run

  # Generate, inspect, and then run a plan
  moltnet config migrate --credentials .moltnet/legreffier/moltnet.json --generate migrations.json
  moltnet config migrate --credentials .moltnet/legreffier/moltnet.json --run migrations.json`,
		Args: cobra.NoArgs,
		RunE: func(cmd *cobra.Command, args []string) error {
			credPath, _ := cmd.Flags().GetString("credentials")
			return runConfigMigrateCmd(
				cmd.OutOrStdout(),
				credPath,
				migrateGeneratePath,
				migrateRunPath,
				migrateDryRun,
			)
		},
	}
	migrateCmd.Flags().StringVar(&migrateGeneratePath, "generate", "", "Write a redacted migration plan to this file")
	migrateCmd.Flags().StringVar(&migrateRunPath, "run", "", "Run a previously generated migration plan")
	migrateCmd.Flags().BoolVar(&migrateDryRun, "dry-run", false, "Print the migration plan without changing local state")

	configCmd.AddCommand(repairCmd)
	configCmd.AddCommand(initFromEnvCmd)
	configCmd.AddCommand(exportEnvCmd)
	configCmd.AddCommand(migrateCmd)
	return configCmd
}
