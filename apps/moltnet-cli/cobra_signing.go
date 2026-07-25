package main

import "github.com/spf13/cobra"

func newSigningRequestsCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "signing-requests",
		Short: "Create and inspect signing requests",
	}
	create := &cobra.Command{
		Use:   "create",
		Short: "Create a signing request",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			credPath := flagString(cmd, "credentials")
			return runSigningRequestCreateCmd(signingRequestCreateOpts{
				apiURL:         resolveAPIURL(cmd, credPath),
				credPath:       credPath,
				message:        flagString(cmd, "message"),
				method:         flagString(cmd, "verification-method"),
				teamID:         flagString(cmd, "team-id"),
				purpose:        flagString(cmd, "purpose"),
				constraintType: flagString(cmd, "constraint-type"),
				constraintID:   flagString(cmd, "constraint-id"),
				out:            cmd.OutOrStdout(),
			})
		},
	}
	create.Flags().String("message", "", "Message to sign (required)")
	create.Flags().String("verification-method", "agent-ed25519", "Exact verification method")
	create.Flags().String("team-id", "", "Team UUID for delegated signing")
	create.Flags().String("purpose", "", "Human-readable signing purpose")
	create.Flags().String("constraint-type", "", "human | team-role | group")
	create.Flags().String("constraint-id", "", "Human, role, or group identifier")
	_ = create.MarkFlagRequired("message")

	list := &cobra.Command{
		Use:   "list",
		Short: "List requested or signable signing requests",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			credPath := flagString(cmd, "credentials")
			return runSigningRequestListCmd(
				resolveAPIURL(cmd, credPath),
				credPath,
				flagString(cmd, "scope"),
				cmd.OutOrStdout(),
			)
		},
	}
	list.Flags().String("scope", "requested", "requested | signable")

	get := &cobra.Command{
		Use:   "get <request-id>",
		Short: "Get one signing request",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			credPath := flagString(cmd, "credentials")
			return runSigningRequestGetCmd(
				resolveAPIURL(cmd, credPath),
				credPath,
				args[0],
				cmd.OutOrStdout(),
			)
		},
	}
	cmd.AddCommand(create, list, get)
	return cmd
}

func newSigningCredentialsCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "signing-credentials",
		Short: "List and manage signing credentials",
	}
	list := &cobra.Command{
		Use:   "list",
		Short: "List signing credentials in a team",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			credPath := flagString(cmd, "credentials")
			return runSigningCredentialListCmd(
				resolveAPIURL(cmd, credPath),
				credPath,
				flagString(cmd, "team-id"),
				cmd.OutOrStdout(),
			)
		},
	}
	list.Flags().String("team-id", "", "Team UUID (required)")
	_ = list.MarkFlagRequired("team-id")
	cmd.AddCommand(list)

	for _, action := range []string{"approve", "suspend", "revoke"} {
		action := action
		leaf := &cobra.Command{
			Use:   action + " <credential-id>",
			Short: action + " a signing credential",
			Args:  cobra.ExactArgs(1),
			RunE: func(cmd *cobra.Command, args []string) error {
				credPath := flagString(cmd, "credentials")
				return runSigningCredentialActionCmd(
					resolveAPIURL(cmd, credPath),
					credPath,
					flagString(cmd, "team-id"),
					args[0],
					action,
					cmd.OutOrStdout(),
				)
			},
		}
		leaf.Flags().String("team-id", "", "Team UUID (required)")
		_ = leaf.MarkFlagRequired("team-id")
		cmd.AddCommand(leaf)
	}
	return cmd
}
