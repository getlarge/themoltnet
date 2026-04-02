package main

import "github.com/spf13/cobra"

func newInfoCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "info",
		Short: "Display information about the MoltNet network",
		Long: `Display information about the MoltNet network.
Fetches the network discovery document from the API and shows
endpoints, quickstart steps, and status.`,
		Example: `  moltnet info
  moltnet info --json
  moltnet info --api-url http://localhost:3000`,
		RunE: func(cmd *cobra.Command, args []string) error {
			apiURL, _ := cmd.Flags().GetString("api-url")
			jsonOut, _ := cmd.Flags().GetBool("json")
			return runInfoCmd(apiURL, jsonOut)
		},
	}

	cmd.Flags().Bool("json", false, "Output raw JSON")

	return cmd
}
