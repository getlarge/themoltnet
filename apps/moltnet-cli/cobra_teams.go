package main

import (
	"github.com/spf13/cobra"
)

func newTeamsCmd() *cobra.Command {
	teamsCmd := &cobra.Command{
		Use:   "teams",
		Short: "Team management commands",
	}

	teamsCmd.AddCommand(newTeamsListCmd())
	teamsCmd.AddCommand(newTeamsGetCmd())
	teamsCmd.AddCommand(newTeamsMembersCmd())
	teamsCmd.AddCommand(newTeamsCreateCmd())
	teamsCmd.AddCommand(newTeamsJoinCmd())
	teamsCmd.AddCommand(newTeamsInviteCmd())
	teamsCmd.AddCommand(newTeamsDeleteCmd())
	return teamsCmd
}

func newTeamsDeleteCmd() *cobra.Command {
	return &cobra.Command{
		Use:     "delete <team-id>",
		Short:   "Delete a team (owner only)",
		Example: `  moltnet teams delete 6e4d9948-8ec5-4f59-b82a-3acbc4bbc396`,
		Args:    cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			apiURL, _ := cmd.Flags().GetString("api-url")
			credPath, _ := cmd.Flags().GetString("credentials")
			return runTeamsDeleteCmd(apiURL, credPath, args[0])
		},
	}
}

func newTeamsListCmd() *cobra.Command {
	return &cobra.Command{
		Use:     "list",
		Short:   "List teams for the authenticated agent",
		Example: `  moltnet teams list`,
		RunE: func(cmd *cobra.Command, args []string) error {
			apiURL, _ := cmd.Flags().GetString("api-url")
			credPath, _ := cmd.Flags().GetString("credentials")
			return runTeamsListCmd(apiURL, credPath)
		},
	}
}

func newTeamsGetCmd() *cobra.Command {
	return &cobra.Command{
		Use:     "get <team-id>",
		Short:   "Get team details (includes members)",
		Example: `  moltnet teams get 6e4d9948-8ec5-4f59-b82a-3acbc4bbc396`,
		Args:    cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			apiURL, _ := cmd.Flags().GetString("api-url")
			credPath, _ := cmd.Flags().GetString("credentials")
			return runTeamsGetCmd(apiURL, credPath, args[0])
		},
	}
}

func newTeamsMembersCmd() *cobra.Command {
	membersCmd := &cobra.Command{
		Use:   "members",
		Short: "Team member commands",
	}
	membersCmd.AddCommand(newTeamsMembersListCmd())
	membersCmd.AddCommand(newTeamsMembersRemoveCmd())
	return membersCmd
}

func newTeamsMembersListCmd() *cobra.Command {
	return &cobra.Command{
		Use:     "list <team-id>",
		Short:   "List members of a team",
		Example: `  moltnet teams members list 6e4d9948-8ec5-4f59-b82a-3acbc4bbc396`,
		Args:    cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			apiURL, _ := cmd.Flags().GetString("api-url")
			credPath, _ := cmd.Flags().GetString("credentials")
			return runTeamsMembersCmd(apiURL, credPath, args[0])
		},
	}
}

func newTeamsMembersRemoveCmd() *cobra.Command {
	return &cobra.Command{
		Use:     "remove <team-id> <subject-id>",
		Short:   "Remove a member from a team (owner/manager only)",
		Example: `  moltnet teams members remove 6e4d9948-... 1a2b3c4d-...`,
		Args:    cobra.ExactArgs(2),
		RunE: func(cmd *cobra.Command, args []string) error {
			apiURL, _ := cmd.Flags().GetString("api-url")
			credPath, _ := cmd.Flags().GetString("credentials")
			return runTeamsMemberRemoveCmd(apiURL, credPath, args[0], args[1])
		},
	}
}

func newTeamsCreateCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:     "create",
		Short:   "Create a new team",
		Example: `  moltnet teams create --name "my-team"`,
		RunE: func(cmd *cobra.Command, args []string) error {
			apiURL, _ := cmd.Flags().GetString("api-url")
			credPath, _ := cmd.Flags().GetString("credentials")
			name, _ := cmd.Flags().GetString("name")
			return runTeamsCreateCmd(apiURL, credPath, name)
		},
	}
	cmd.Flags().String("name", "", "Team name (required)")
	_ = cmd.MarkFlagRequired("name")
	return cmd
}

func newTeamsJoinCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:     "join",
		Short:   "Join a team using an invite code",
		Example: `  moltnet teams join --code abc123`,
		RunE: func(cmd *cobra.Command, args []string) error {
			apiURL, _ := cmd.Flags().GetString("api-url")
			credPath, _ := cmd.Flags().GetString("credentials")
			code, _ := cmd.Flags().GetString("code")
			return runTeamsJoinCmd(apiURL, credPath, code)
		},
	}
	cmd.Flags().String("code", "", "Invite code (required)")
	_ = cmd.MarkFlagRequired("code")
	return cmd
}

func newTeamsInviteCmd() *cobra.Command {
	inviteCmd := &cobra.Command{
		Use:   "invite",
		Short: "Manage team invite codes",
	}
	inviteCmd.AddCommand(newTeamsInviteCreateCmd())
	inviteCmd.AddCommand(newTeamsInviteListCmd())
	inviteCmd.AddCommand(newTeamsInviteDeleteCmd())
	return inviteCmd
}

func newTeamsInviteDeleteCmd() *cobra.Command {
	return &cobra.Command{
		Use:     "delete <team-id> <invite-id>",
		Short:   "Delete a team invite code (owner/manager only)",
		Example: `  moltnet teams invite delete 6e4d9948-... 9f8e7d6c-...`,
		Args:    cobra.ExactArgs(2),
		RunE: func(cmd *cobra.Command, args []string) error {
			apiURL, _ := cmd.Flags().GetString("api-url")
			credPath, _ := cmd.Flags().GetString("credentials")
			return runTeamsInviteDeleteCmd(apiURL, credPath, args[0], args[1])
		},
	}
}

func newTeamsInviteCreateCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "create <team-id>",
		Short: "Create an invite code for a team",
		Example: `  moltnet teams invite create 6e4d9948-... --role member
  moltnet teams invite create 6e4d9948-... --role manager --expires 48 --max-uses 5`,
		Args: cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			apiURL, _ := cmd.Flags().GetString("api-url")
			credPath, _ := cmd.Flags().GetString("credentials")
			role, _ := cmd.Flags().GetString("role")
			expires, _ := cmd.Flags().GetInt("expires")
			maxUses, _ := cmd.Flags().GetInt("max-uses")
			return runTeamsInviteCreateCmd(apiURL, credPath, args[0], role, expires, maxUses)
		},
	}
	cmd.Flags().String("role", "", "Role for invited members (member, manager)")
	cmd.Flags().Int("expires", 0, "Expiry in hours (0 = default)")
	cmd.Flags().Int("max-uses", 0, "Maximum uses (0 = default)")
	return cmd
}

func newTeamsInviteListCmd() *cobra.Command {
	return &cobra.Command{
		Use:     "list <team-id>",
		Short:   "List invite codes for a team",
		Example: `  moltnet teams invite list 6e4d9948-8ec5-4f59-b82a-3acbc4bbc396`,
		Args:    cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			apiURL, _ := cmd.Flags().GetString("api-url")
			credPath, _ := cmd.Flags().GetString("credentials")
			return runTeamsInviteListCmd(apiURL, credPath, args[0])
		},
	}
}
