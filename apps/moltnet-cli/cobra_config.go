package main

import (
	"fmt"

	"github.com/spf13/cobra"
)

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
		Long: `Reconstruct a central identity directory from environment variables.
Designed for ephemeral environments (CI, Claude Code web) where
moltnet agents init cannot run interactively.

Identity alias resolution: --name flag > MOLTNET_ACTIVE_IDENTITY env var.

Required env vars:
  MOLTNET_IDENTITY_ID, MOLTNET_CLIENT_ID, MOLTNET_CLIENT_SECRET,
  MOLTNET_PUBLIC_KEY, MOLTNET_PRIVATE_KEY, MOLTNET_FINGERPRINT

Optional env vars:
  MOLTNET_ACTIVE_IDENTITY (alternative to --name flag)
  MOLTNET_API_URL (default: https://api.themolt.net)
  MOLTNET_REGISTERED_AT (default: now)
  MOLTNET_GIT_NAME (default: agent name), MOLTNET_GIT_EMAIL
  MOLTNET_GITHUB_APP_ID, MOLTNET_GITHUB_APP_SLUG,
  MOLTNET_GITHUB_APP_INSTALLATION_ID, MOLTNET_GITHUB_APP_PRIVATE_KEY`,
		Example: `  # Set env vars, then run:
  moltnet config init-from-env --name legreffier
  moltnet config init-from-env --name legreffier --skip-git

  # Derive identity alias from MOLTNET_ACTIVE_IDENTITY in env file:
  moltnet config init-from-env --env-file .env.moltnet

  # Load vars from a file and override process env:
  moltnet config init-from-env --name legreffier --env-file .env.moltnet --override`,
		RunE: func(cmd *cobra.Command, args []string) error {
			name, _ := cmd.Flags().GetString("name")
			skipGit, _ := cmd.Flags().GetBool("skip-git")
			envFile, _ := cmd.Flags().GetString("env-file")
			override, _ := cmd.Flags().GetBool("override")
			return runConfigInitFromEnvCmd("", name, skipGit, envFile, override)
		},
	}
	initFromEnvCmd.Flags().String("name", "", "Identity alias (or set MOLTNET_ACTIVE_IDENTITY)")
	initFromEnvCmd.Flags().Bool("skip-git", false, "Skip git signing setup")
	initFromEnvCmd.Flags().String("env-file", "", "Load variables from a dotenv file")
	initFromEnvCmd.Flags().Bool("override", false, "Let env-file values override process environment")

	exportEnvCmd := &cobra.Command{
		Use:   "export-env",
		Short: "Export agent config as MOLTNET_* environment variables",
		Long: `Read a moltnet.json config and emit corresponding MOLTNET_* variables
in dotenv format. Stdout omits private values unless --show-secret is set.
An output file includes it and is written atomically with mode 0600.`,
		Example: `  # Print non-secret values to stdout
  moltnet config export-env --credentials .moltnet/legreffier/moltnet.json

  # Explicitly reveal the OAuth2 secret
  moltnet config export-env --credentials .moltnet/legreffier/moltnet.json --show-secret

  # Write to file
  moltnet config export-env --credentials .moltnet/legreffier/moltnet.json -o .env.moltnet

  # Include GitHub App PEM content
  moltnet config export-env --credentials .moltnet/legreffier/moltnet.json --include-github-pem -o .env.moltnet`,
		RunE: func(cmd *cobra.Command, args []string) error {
			credPath, _ := cmd.Flags().GetString("credentials")
			outFile, _ := cmd.Flags().GetString("output")
			includeGitHubPEM, _ := cmd.Flags().GetBool("include-github-pem")
			showSecret, _ := cmd.Flags().GetBool("show-secret")
			return runConfigExportEnvCmd(cmd.OutOrStdout(), credPath, outFile, includeGitHubPEM, showSecret)
		},
	}
	exportEnvCmd.Flags().StringP("output", "o", "", "Write to file instead of stdout")
	exportEnvCmd.Flags().Bool("include-github-pem", false, "Include GitHub App private key content")
	exportEnvCmd.Flags().Bool("show-secret", false, "Include OAuth2 and identity private secrets in stdout")

	var migrateGeneratePath string
	var migrateRunPath string
	var migrateDryRun bool
	var migrateDestination string
	var migrateName string
	migrateCmd := &cobra.Command{
		Use:   "migrate",
		Short: "Plan and apply configuration migrations",
		Long: `Plan and apply the next state-aware MoltNet configuration migration.
Each redacted JSON plan is bound to the exact credentials file content and
contains at most one transition. Run the command again to apply the next one.
Use --generate to inspect a plan before applying it with --run. Secrets move
into the --destination provider (default os-keyring); pass the same
--destination when running a generated plan.`,
		Example: `  # Apply the next migration
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
				migrateDestination,
				migrateDryRun,
				migrateName,
			)
		},
	}
	migrateCmd.Flags().StringVar(&migrateGeneratePath, "generate", "", "Write a redacted migration plan to this file")
	migrateCmd.Flags().StringVar(&migrateRunPath, "run", "", "Run a previously generated migration plan")
	migrateCmd.Flags().BoolVar(&migrateDryRun, "dry-run", false, "Print the migration plan without changing local state")
	migrateCmd.Flags().StringVar(&migrateName, "name", "", "Central identity alias (required when it cannot be derived from a legacy .moltnet/<alias> directory)")
	migrateCmd.Flags().StringVar(&migrateDestination, "destination", defaultMigrationDestination, "Secret provider that receives migrated secrets (os-keyring, or file with MOLTNET_SECRET_ROOT_WRITABLE=1)")

	portOpts := configPortOpts{}
	portCmd := &cobra.Command{
		Use:   "port",
		Short: "Port an agent configuration into this repository",
		Long: `Copy a validated .moltnet/<agent> configuration into another
repository, preserve provider-backed secrets by reference, and regenerate all
repository-bound SSH, Git, environment, and activation files. This command
does not install or configure agent-host plugins.`,
		Example: `  moltnet config port --from /path/to/repo/.moltnet/legreffier
  moltnet config port --from /path/to/repo/.moltnet/legreffier --dir . --name reviewer`,
		Args: cobra.NoArgs,
		RunE: func(cmd *cobra.Command, args []string) error {
			portOpts.out = cmd.OutOrStdout()
			return runConfigPortCmd(portOpts)
		},
	}
	portCmd.Flags().StringVar(&portOpts.from, "from", "", "Source .moltnet/<agent> directory (required)")
	portCmd.Flags().StringVar(&portOpts.dir, "dir", ".", "Target repository root directory")
	portCmd.Flags().StringVar(&portOpts.name, "name", "", "Target agent name (default: source directory name)")
	portCmd.Flags().StringVar(&portOpts.installationID, "installation-id", "", "Override the GitHub App installation ID")
	_ = portCmd.MarkFlagRequired("from")

	configCmd.AddCommand(repairCmd)
	configCmd.AddCommand(initFromEnvCmd)
	configCmd.AddCommand(exportEnvCmd)
	configCmd.AddCommand(migrateCmd)
	// `config port` copied repository-owned identity material. Identities now
	// live centrally; repository bindings are intentionally a separate concern.
	_ = portCmd
	configCmd.AddCommand(newConfigIdentityCmd())
	return configCmd
}

func newConfigIdentityCmd() *cobra.Command {
	identityCmd := &cobra.Command{
		Use:   "identity",
		Short: "Manage locally stored agent identities",
	}
	listCmd := &cobra.Command{
		Use:   "list",
		Short: "List central identity aliases",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, args []string) error {
			aliases, err := listIdentityAliases()
			if err != nil {
				return err
			}
			selector, err := readIdentitySelector()
			if err != nil {
				return err
			}
			defaultAlias := ""
			if selector != nil {
				defaultAlias = selector.DefaultIdentity
			}
			return printJSONTo(cmd.OutOrStdout(), map[string]interface{}{"identities": aliases, "default": defaultAlias})
		},
	}
	showCmd := &cobra.Command{
		Use:   "show [alias]",
		Short: "Show a central identity document without resolving its secrets",
		Args:  cobra.MaximumNArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			alias := ""
			if len(args) == 1 {
				alias = args[0]
			}
			alias, err := resolveIdentityAlias(alias)
			if err != nil {
				return err
			}
			path, err := identityCredentialsPath(alias)
			if err != nil {
				return err
			}
			creds, err := ReadConfigFrom(path)
			if err != nil {
				return err
			}
			if creds == nil {
				return fmt.Errorf("identity %q not found", alias)
			}
			return printJSONTo(cmd.OutOrStdout(), map[string]interface{}{"alias": alias, "path": path, "identity": creds})
		},
	}
	selectCmd := &cobra.Command{
		Use:   "select <alias>",
		Short: "Persist the default central identity",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			path, err := identityCredentialsPath(args[0])
			if err != nil {
				return err
			}
			if !regularFileExists(path) {
				return fmt.Errorf("identity %q not found", args[0])
			}
			if err := writeIdentitySelector(args[0]); err != nil {
				return err
			}
			fmt.Fprintf(cmd.OutOrStdout(), "Default identity set to %q\n", args[0])
			return nil
		},
	}
	identityCmd.AddCommand(listCmd, showCmd, selectCmd)
	return identityCmd
}
