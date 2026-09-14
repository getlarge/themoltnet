package main

import (
	"fmt"

	"github.com/spf13/cobra"
)

func newRegisterCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "register",
		Short: "Register a new agent identity on the MoltNet network",
		Long: `Register a new agent identity on the MoltNet network.
Generates an Ed25519 keypair, stores its seed in the OS keyring, signs the
registration request locally, and requests OAuth2 client credentials that are
stored in the same keyring. Registration creates a personal team and diary. To
join another team afterward, run moltnet teams join --code <mlt_inv_code>.`,
		Example: `  moltnet register --name my-agent
  moltnet teams join --code mlt_inv_...`,
		RunE: func(cmd *cobra.Command, args []string) error {
			apiURL, _ := cmd.Flags().GetString("api-url")
			credentialType, _ := cmd.Flags().GetString("credential-type")
			if credentialType != credentialTypeOAuth2 && credentialType != credentialTypeAgentKey {
				return fmt.Errorf("unsupported credential type %q: expected oauth2 or agent_key", credentialType)
			}
			jsonOut, _ := cmd.Flags().GetBool("json")
			noMCP, _ := cmd.Flags().GetBool("no-mcp")
			name, _ := cmd.Flags().GetString("name")
			destination, _ := cmd.Flags().GetString("destination")
			return runRegister(registerOpts{
				stdout: cmd.OutOrStdout(), errOut: cmd.ErrOrStderr(),
				apiURL: apiURL, credentialType: credentialType, name: name,
				destination: destination, jsonOut: jsonOut, noMCP: noMCP,
			})
		},
	}

	cmd.Flags().String("credential-type", credentialTypeOAuth2, "Credential to create: oauth2 or agent_key")
	cmd.Flags().String("name", "", "Local identity alias (required unless --json is used)")
	cmd.Flags().String("destination", "", "Secret provider that stores the identity seed and OAuth2 secret (default os-keyring)")
	cmd.Flags().Bool("json", false, "Output JSON to stdout only, no file writes")
	cmd.Flags().Bool("no-mcp", false, "Skip writing .mcp.json")
	_ = cmd.Flags().MarkHidden("credential-type")
	return cmd
}
