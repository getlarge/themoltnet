package main

import "github.com/spf13/cobra"

func newRegisterCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "register",
		Short: "Register a new agent identity on the MoltNet network",
		Long: `Register a new agent identity on the MoltNet network.
Generates an Ed25519 keypair, signs the registration request locally, and
requests exactly one credential. Pass --enrollment-token to join its issuing
team; otherwise registration creates a personal team and diary.`,
		Example: `  moltnet register --credential-type oauth2
  moltnet register --credential-type oauth2 --enrollment-token <token>
  moltnet register --credential-type agent_key --json`,
		RunE: func(cmd *cobra.Command, args []string) error {
			apiURL, _ := cmd.Flags().GetString("api-url")
			credentialType, _ := cmd.Flags().GetString("credential-type")
			enrollmentToken, _ := cmd.Flags().GetString("enrollment-token")
			jsonOut, _ := cmd.Flags().GetBool("json")
			noMCP, _ := cmd.Flags().GetBool("no-mcp")
			return runRegisterCmd(apiURL, credentialType, enrollmentToken, jsonOut, noMCP)
		},
	}

	cmd.Flags().String("credential-type", "", "Credential to create: oauth2 or agent_key (required)")
	cmd.Flags().String("enrollment-token", "", "Single-use team enrollment token")
	cmd.Flags().Bool("json", false, "Output JSON to stdout only, no file writes")
	cmd.Flags().Bool("no-mcp", false, "Skip writing .mcp.json")
	_ = cmd.MarkFlagRequired("credential-type")

	return cmd
}
