package main

import "github.com/spf13/cobra"

func newAgentsCredentialsCmd() *cobra.Command {
	credentialsCmd := &cobra.Command{
		Use:   "credentials",
		Short: "Manage this agent's OAuth2 credentials",
	}

	rotateCmd := &cobra.Command{
		Use:   "rotate",
		Short: "Rotate and persist this agent's OAuth2 client secret",
		Long: `Rotate the OAuth2 client secret in the resolved credentials file.

The old client secret is invalidated immediately. Access tokens already issued
with it remain valid until they expire, so stop or restart agent processes after
rotation when responding to a compromise.

The new secret is written atomically to the credentials file with owner-only
permissions and is hidden from normal output. Use --show-secret only when
another secure secret store must be updated manually. Use
--no-update --show-secret to rotate without changing the local file.`,
		Example: `  moltnet agents credentials rotate --yes
  moltnet agents credentials rotate --yes --show-secret
  moltnet agents credentials rotate --yes --no-update --show-secret`,
		Args: cobra.NoArgs,
		RunE: func(cmd *cobra.Command, args []string) error {
			credPath := flagString(cmd, "credentials")
			opts := agentsCredentialsRotateOpts{
				apiURL:         flagString(cmd, "api-url"),
				apiURLExplicit: cmd.Flag("api-url").Changed,
				credPath:       credPath,
				yes:            flagBool(cmd, "yes"),
				showSecret:     flagBool(cmd, "show-secret"),
				noUpdate:       flagBool(cmd, "no-update"),
				out:            cmd.OutOrStdout(),
				errOut:         cmd.ErrOrStderr(),
			}
			return runAgentsCredentialsRotateCmd(opts)
		},
	}
	rotateCmd.Flags().Bool("yes", false, "Confirm the irreversible rotation")
	rotateCmd.Flags().Bool("show-secret", false, "Include the new client secret in stdout")
	rotateCmd.Flags().Bool("no-update", false, "Do not update the credentials file (requires --show-secret)")

	credentialsCmd.AddCommand(rotateCmd)
	return credentialsCmd
}
