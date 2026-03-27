package main

import (
	"fmt"

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
			return runCryptoIdentityCmd(apiURL)
		},
	}

	var signature string
	verifyCmd := &cobra.Command{
		Use:   "verify",
		Short: "Verify a signature against your registered public key",
		RunE: func(cmd *cobra.Command, args []string) error {
			if signature == "" {
				return fmt.Errorf("required flag \"signature\" not set")
			}
			apiURL, _ := cmd.Flags().GetString("api-url")
			return runCryptoVerifyCmd(apiURL, signature)
		},
	}
	verifyCmd.Flags().StringVar(&signature, "signature", "", "Base64-encoded signature to verify (required)")

	cryptoCmd.AddCommand(identityCmd)
	cryptoCmd.AddCommand(verifyCmd)
	return cryptoCmd
}
