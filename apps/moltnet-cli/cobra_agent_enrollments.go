package main

import "github.com/spf13/cobra"

func newAgentEnrollmentsCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "enrollments",
		Short: "Issue and revoke team agent enrollments",
	}

	create := &cobra.Command{
		Use:   "create",
		Short: "Create a single-use enrollment token",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			credPath := flagString(cmd, "credentials")
			return runAgentEnrollmentCreateCmd(agentEnrollmentCreateOpts{
				apiURL: resolveAPIURL(cmd, credPath), credPath: credPath,
				teamID:           flagString(cmd, "team-id"),
				expiresInMinutes: flagInt(cmd, "expires-in-minutes"),
				expiresSet:       cmd.Flags().Changed("expires-in-minutes"),
				out:              cmd.OutOrStdout(),
			})
		},
	}
	create.Flags().String("team-id", "", "Team UUID (required)")
	create.Flags().Int("expires-in-minutes", 15, "Token lifetime from 1 to 60 minutes")
	_ = create.MarkFlagRequired("team-id")

	revoke := &cobra.Command{
		Use:   "revoke <enrollment-id>",
		Short: "Revoke an unused enrollment",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			credPath := flagString(cmd, "credentials")
			return runAgentEnrollmentRevokeCmd(
				resolveAPIURL(cmd, credPath), credPath,
				flagString(cmd, "team-id"), args[0],
			)
		},
	}
	revoke.Flags().String("team-id", "", "Team UUID (required)")
	_ = revoke.MarkFlagRequired("team-id")

	cmd.AddCommand(create, revoke)
	return cmd
}
