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
			apiURL, _ := cmd.Flags().GetString("api-url")
			credPath, _ := cmd.Flags().GetString("credentials")
			return runAgentsWhoamiCmd(apiURL, credPath)
		},
	}

	lookupCmd := &cobra.Command{
		Use:   "lookup <fingerprint>",
		Short: "Look up an agent profile by their key fingerprint",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			apiURL, _ := cmd.Flags().GetString("api-url")
			credPath, _ := cmd.Flags().GetString("credentials")
			return runAgentsLookupCmd(apiURL, credPath, args[0])
		},
	}

	activationCmd := &cobra.Command{
		Use:   "activation",
		Short: "Manage local agent activation cache",
	}

	validateCmd := &cobra.Command{
		Use:   "validate",
		Short: "Validate local activation cache without network calls",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, args []string) error {
			dir, _ := cmd.Flags().GetString("dir")
			agent, _ := cmd.Flags().GetString("agent")
			jsonOut, _ := cmd.Flags().GetBool("json")
			return runAgentsActivationValidateCmd(cmd.OutOrStdout(), dir, agent, jsonOut)
		},
	}
	validateCmd.Flags().String("agent", "", "Agent name (overrides default)")
	validateCmd.Flags().String("dir", ".", "Repository root directory")
	validateCmd.Flags().Bool("json", false, "Print machine-readable JSON")

	refreshCmd := &cobra.Command{
		Use:   "refresh",
		Short: "Refresh local activation cache from local config files",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, args []string) error {
			dir, _ := cmd.Flags().GetString("dir")
			agent, _ := cmd.Flags().GetString("agent")
			jsonOut, _ := cmd.Flags().GetBool("json")
			return runAgentsActivationRefreshCmd(cmd.OutOrStdout(), dir, agent, jsonOut)
		},
	}
	refreshCmd.Flags().String("agent", "", "Agent name (overrides default)")
	refreshCmd.Flags().String("dir", ".", "Repository root directory")
	refreshCmd.Flags().Bool("json", false, "Print machine-readable JSON")

	clearCmd := &cobra.Command{
		Use:   "clear",
		Short: "Clear local activation cache",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, args []string) error {
			dir, _ := cmd.Flags().GetString("dir")
			agent, _ := cmd.Flags().GetString("agent")
			return runAgentsActivationClearCmd(cmd.OutOrStdout(), dir, agent)
		},
	}
	clearCmd.Flags().String("agent", "", "Agent name (overrides default)")
	clearCmd.Flags().String("dir", ".", "Repository root directory")

	activationCmd.AddCommand(validateCmd)
	activationCmd.AddCommand(refreshCmd)
	activationCmd.AddCommand(clearCmd)

	agentsCmd.AddCommand(whoamiCmd)
	agentsCmd.AddCommand(lookupCmd)
	agentsCmd.AddCommand(activationCmd)
	return agentsCmd
}
