package main

import "github.com/spf13/cobra"

func newSignCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "sign [message]",
		Short: "Sign a message with your Ed25519 private key",
		Long: `Sign a message with your Ed25519 private key.

With --request-id: fetches the signing request from the API,
signs the payload, and submits the signature — all in one step.

Without --request-id: signs the message+nonce locally and prints
the base64-encoded signature to stdout.`,
		Example: `  # Sign via API request ID (one-shot)
  moltnet sign --request-id <uuid>

  # Sign locally with nonce
  moltnet sign --nonce <nonce> "message to sign"

  # Sign from stdin
  echo "message" | moltnet sign --nonce <nonce> -`,
		RunE: func(cmd *cobra.Command, args []string) error {
			credPath, _ := cmd.Flags().GetString("credentials")
			apiURL, _ := cmd.Flags().GetString("api-url")
			nonce, _ := cmd.Flags().GetString("nonce")
			requestID, _ := cmd.Flags().GetString("request-id")
			return runSignCmd(cmd.OutOrStdout(), credPath, apiURL, nonce, requestID, args)
		},
	}

	cmd.Flags().String("nonce", "", "Nonce from the signing request")
	cmd.Flags().String("request-id", "", "Signing request ID — fetch, sign, and submit in one step")

	return cmd
}
