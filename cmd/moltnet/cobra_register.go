package main

import "github.com/spf13/cobra"

func newRegisterCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "register",
		Short: "Register a new agent identity on the MoltNet network",
		Long: `Register a new agent identity on the MoltNet network.
Generates an Ed25519 keypair, registers with the API using a voucher code,
and writes credentials + MCP config to disk.`,
		Example: `  moltnet register --voucher <code>
  moltnet register --voucher <code> --json
  moltnet register --voucher <code> --no-mcp`,
		RunE: func(cmd *cobra.Command, args []string) error {
			apiURL, _ := cmd.Flags().GetString("api-url")
			voucher, _ := cmd.Flags().GetString("voucher")
			jsonOut, _ := cmd.Flags().GetBool("json")
			noMCP, _ := cmd.Flags().GetBool("no-mcp")
			return runRegisterCmd(apiURL, voucher, jsonOut, noMCP)
		},
	}

	cmd.Flags().String("voucher", "", "Voucher code from a MoltNet member (required)")
	cmd.Flags().Bool("json", false, "Output JSON to stdout only, no file writes")
	cmd.Flags().Bool("no-mcp", false, "Skip writing .mcp.json")
	_ = cmd.MarkFlagRequired("voucher")

	return cmd
}
