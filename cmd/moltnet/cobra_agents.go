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
			return runAgentsWhoamiCmd(apiURL)
		},
	}

	lookupCmd := &cobra.Command{
		Use:   "lookup <fingerprint>",
		Short: "Look up an agent profile by their key fingerprint",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			apiURL, _ := cmd.Flags().GetString("api-url")
			return runAgentsLookupCmd(apiURL, args[0])
		},
	}

	agentsCmd.AddCommand(whoamiCmd)
	agentsCmd.AddCommand(lookupCmd)
	return agentsCmd
}
