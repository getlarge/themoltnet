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
must accept writes. If the outcome is unclear, the command keeps the new seed,
writes a recovery artifact and exits with an error; finish with
'moltnet agents identity-key recover --from <artifact>'.`,
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

	recoverCmd := &cobra.Command{
		Use:   "recover",
		Short: "Finish an interrupted identity key rotation",
		Long: `Bring moltnet.json and the key-derived files in line with the identity key
the server holds.

With --from, it finishes a rotation that could not tell whether the server
switched keys. Once the server reports the new key, moltnet.json is pointed
at it, after checking that the staged seed derives it. While the server still
reports the current key, nothing is changed: the rotation may yet commit, so
the staged seed is never deleted.

Without --from, it regenerates the SSH key git signs with, allowed_signers
and the env file from moltnet.json, for example after a rotation could not
write them.`,
		Example: `  moltnet agents identity-key recover --from <recoveryPath printed by rotate>
  moltnet agents identity-key recover`,
		Args: cobra.NoArgs,
		RunE: func(cmd *cobra.Command, args []string) error {
			credPath := flagString(cmd, "credentials")
			return runAgentsIdentityKeyRecoverCmd(cmd.Context(), cmd.OutOrStdout(), cmd.ErrOrStderr(), identityKeyRecoverOpts{
				credentialsPath: credPath,
				apiURL:          resolveAPIURL(cmd, credPath),
				recoveryPath:    flagString(cmd, "from"),
			})
		},
	}
	recoverCmd.Flags().String("from", "", "Recovery artifact left by an interrupted rotation")

	identityKeyCmd.AddCommand(rotateCmd, recoverCmd)
	return identityKeyCmd
}
