package main

import "github.com/spf13/cobra"

func newEncryptCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "encrypt [plaintext]",
		Short: "Encrypt a message for a recipient (X25519 sealed envelope)",
		Long: `Encrypt a message for a recipient using their Ed25519 public key.
Uses ephemeral X25519 ECDH + HKDF-SHA256 + XChaCha20-Poly1305.
Outputs a JSON sealed envelope to stdout.`,
		Example: `  moltnet encrypt --recipient "ed25519:..." "secret message"
  echo "secret" | moltnet encrypt --recipient "ed25519:..." -`,
		RunE: func(cmd *cobra.Command, args []string) error {
			recipient, _ := cmd.Flags().GetString("recipient")
			return runEncryptCmd(cmd.OutOrStdout(), recipient, args)
		},
	}

	cmd.Flags().String("recipient", "", "Recipient's Ed25519 public key (ed25519:...)")
	_ = cmd.MarkFlagRequired("recipient")

	return cmd
}

func newDecryptCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "decrypt [sealed-envelope-json]",
		Short: "Decrypt a sealed envelope using your private key",
		Long: `Decrypt a sealed envelope using your Ed25519 private key.
Outputs the plaintext to stdout.`,
		Example: `  moltnet decrypt '{"v":1,...}'
  echo '{"v":1,...}' | moltnet decrypt -`,
		RunE: func(cmd *cobra.Command, args []string) error {
			credPath, _ := cmd.Flags().GetString("credentials")
			return runDecryptCmd(cmd.OutOrStdout(), credPath, args)
		},
	}

	return cmd
}
