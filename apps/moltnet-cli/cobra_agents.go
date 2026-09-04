package main

import "github.com/spf13/cobra"

func newAgentsCmd() *cobra.Command {
	agentsCmd := &cobra.Command{
		Use:   "agents",
		Short: "Agent identity commands",
	}

	whoamiCmd := &cobra.Command{
		Use:   "whoami",
		Short: "Display your agent identity as registered on the MoltNet network",
		RunE: func(cmd *cobra.Command, args []string) error {
			credPath, _ := cmd.Flags().GetString("credentials")
			apiURL := resolveAPIURL(cmd, credPath)
			return runAgentsWhoamiCmd(apiURL, credPath)
		},
	}

	lookupCmd := &cobra.Command{
		Use:   "lookup <fingerprint>",
		Short: "Look up an agent profile by their key fingerprint",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			credPath, _ := cmd.Flags().GetString("credentials")
			apiURL := resolveAPIURL(cmd, credPath)
			return runAgentsLookupCmd(apiURL, credPath, args[0])
		},
	}

	initCmd := newAgentsInitCmd()

	activationCmd := &cobra.Command{
		Use:   "activation",
		Short: "Manage local agent activation cache",
	}

	validateCmd := &cobra.Command{
		Use:   "validate",
		Short: "Validate local activation cache without network calls",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, args []string) error {
			identity, _ := cmd.Flags().GetString("identity")
			jsonOut, _ := cmd.Flags().GetBool("json")
			return runAgentsActivationValidateCmd(cmd.OutOrStdout(), identity, jsonOut)
		},
	}
	validateCmd.Flags().String("identity", "", "Identity alias (overrides active identity)")
	validateCmd.Flags().Bool("json", false, "Print machine-readable JSON")

	refreshCmd := &cobra.Command{
		Use:   "refresh",
		Short: "Refresh local activation cache from local config files",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, args []string) error {
			identity, _ := cmd.Flags().GetString("identity")
			jsonOut, _ := cmd.Flags().GetBool("json")
			return runAgentsActivationRefreshCmd(cmd.OutOrStdout(), identity, jsonOut)
		},
	}
	refreshCmd.Flags().String("identity", "", "Identity alias (overrides active identity)")
	refreshCmd.Flags().Bool("json", false, "Print machine-readable JSON")

	clearCmd := &cobra.Command{
		Use:   "clear",
		Short: "Clear local activation cache",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, args []string) error {
			identity, _ := cmd.Flags().GetString("identity")
			return runAgentsActivationClearCmd(cmd.OutOrStdout(), identity)
		},
	}
	clearCmd.Flags().String("identity", "", "Identity alias (overrides active identity)")

	activationCmd.AddCommand(validateCmd)
	activationCmd.AddCommand(refreshCmd)
	activationCmd.AddCommand(clearCmd)

	agentsCmd.AddCommand(whoamiCmd)
	agentsCmd.AddCommand(lookupCmd)
	agentsCmd.AddCommand(initCmd)
	agentsCmd.AddCommand(activationCmd)
	agentsCmd.AddCommand(newAgentsKeysCmd())
	agentsCmd.AddCommand(newAgentEnrollmentsCmd())
	agentsCmd.AddCommand(newAgentsCredentialsCmd())
	return agentsCmd
}
