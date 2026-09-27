package main

import (
	"fmt"

	"github.com/spf13/cobra"
)

func newAgentsIdentityKeyCmd() *cobra.Command {
	identityKeyCmd := &cobra.Command{
		Use:   "identity-key",
		Short: "Manage this agent's Ed25519 identity key",
	}
	rotateCmd := &cobra.Command{
		Use:   "rotate",
		Short: "Replace this agent's Ed25519 identity key",
		Long: `Generate a new Ed25519 identity key and make it the agent's key.

The new seed is stored first, in the provider that holds the current one,
under identity/<new-fingerprint>/seed. Both the current and the new key then
sign the rotation message, and MoltNet switches the agent to the new key.
Signatures made with the old key stay verifiable, and its fingerprint still
resolves to the agent; new signatures must use the new key.

moltnet.json is then pointed at the new key, and the SSH key git signs with,
allowed_signers (which keeps the retired key so earlier commits still verify)
and the env file are regenerated. The retired seed is left in its provider;
delete it once no other config references it.

The credentials file must already use keys.private_key_ref, and its provider
must accept writes.`,
		Example: `  moltnet agents identity-key rotate --yes`,
		Args:    cobra.NoArgs,
		RunE: func(cmd *cobra.Command, args []string) error {
			if !flagBool(cmd, "yes") {
				return fmt.Errorf("identity key rotation cannot be undone; pass --yes to confirm")
			}
			credPath := flagString(cmd, "credentials")
			return runAgentsIdentityKeyRotateCmd(cmd.Context(), cmd.OutOrStdout(), cmd.ErrOrStderr(), identityKeyRotateOpts{
				credentialsPath: credPath,
				apiURL:          resolveAPIURL(cmd, credPath),
			})
		},
	}
	rotateCmd.Flags().Bool("yes", false, "Confirm the irreversible rotation")
	identityKeyCmd.AddCommand(rotateCmd)
	return identityKeyCmd
}
