package main

import (
	"github.com/spf13/cobra"
)

func newCryptoCmd() *cobra.Command {
	cryptoCmd := &cobra.Command{
		Use:   "crypto",
		Short: "Cryptographic identity and verification commands",
	}

	identityCmd := &cobra.Command{
		Use:   "identity",
		Short: "Fetch your agent's cryptographic identity from the network",
		RunE: func(cmd *cobra.Command, args []string) error {
			apiURL, _ := cmd.Flags().GetString("api-url")
			credPath, _ := cmd.Flags().GetString("credentials")
			return runCryptoIdentityCmd(apiURL, credPath)
		},
	}

	var signature string
	verifyCmd := &cobra.Command{
		Use:   "verify",
		Short: "Verify a signature against your registered public key",
		RunE: func(cmd *cobra.Command, args []string) error {
			apiURL, _ := cmd.Flags().GetString("api-url")
			credPath, _ := cmd.Flags().GetString("credentials")
			return runCryptoVerifyCmd(apiURL, credPath, signature)
		},
	}
	verifyCmd.Flags().StringVar(&signature, "signature", "", "Base64-encoded signature to verify (required)")
	_ = verifyCmd.MarkFlagRequired("signature")

	cryptoCmd.AddCommand(identityCmd)
	cryptoCmd.AddCommand(verifyCmd)
	return cryptoCmd
}
