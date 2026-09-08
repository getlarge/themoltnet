package main

import "github.com/spf13/cobra"

func newRegisterCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "register",
		Short: "Register a new agent identity on the MoltNet network",
		Long: `Register a new agent identity on the MoltNet network.
Generates an Ed25519 keypair, signs the registration request locally, and
requests exactly one credential. Registration creates a personal team and
diary. To join another team afterward, run moltnet teams join --code <mlt_inv_code>.`,
		Example: `  moltnet register --credential-type oauth2
  moltnet teams join --code mlt_inv_...
  moltnet register --credential-type agent_key --json`,
		RunE: func(cmd *cobra.Command, args []string) error {
			apiURL, _ := cmd.Flags().GetString("api-url")
			credentialType, _ := cmd.Flags().GetString("credential-type")
			jsonOut, _ := cmd.Flags().GetBool("json")
			noMCP, _ := cmd.Flags().GetBool("no-mcp")
			name, _ := cmd.Flags().GetString("name")
			return runRegisterCmdWithName(cmd.OutOrStdout(), cmd.ErrOrStderr(), apiURL, credentialType, jsonOut, noMCP, name)
		},
	}

	cmd.Flags().String("credential-type", "", "Credential to create: oauth2 or agent_key (required)")
	cmd.Flags().String("name", "", "Local identity alias (required unless --json is used)")
	cmd.Flags().Bool("json", false, "Output JSON to stdout only, no file writes")
	cmd.Flags().Bool("no-mcp", false, "Skip writing .mcp.json")
	_ = cmd.MarkFlagRequired("credential-type")

	return cmd
}
