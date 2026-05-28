package main

import (
	"github.com/spf13/cobra"
)

func newDiaryCmd() *cobra.Command {
	diaryCmd := &cobra.Command{
		Use:   "diary",
		Short: "Diary management commands",
	}

	diaryCmd.AddCommand(newDiaryListCmd())
	diaryCmd.AddCommand(newDiaryCreateCmd())
	diaryCmd.AddCommand(newDiaryGetCmd())
	diaryCmd.AddCommand(newDiaryTagsCmd())
	diaryCmd.AddCommand(newDiaryGrantsCmd())
	diaryCmd.AddCommand(newDiaryTransferCmd())

	return diaryCmd
}

func newDiaryTransferCmd() *cobra.Command {
	transferCmd := &cobra.Command{
		Use:   "transfer",
		Short: "Two-phase diary ownership transfer between teams",
		Long: `Diary transfer is a two-phase workflow: the source team initiates a
transfer to a destination team, and an owner of the destination team must
accept it before the diary is reparented. Until acceptance the diary stays on
the source team; if rejected or expired (7 days) nothing changes.`,
	}
	transferCmd.AddCommand(newDiaryTransferInitiateCmd())
	transferCmd.AddCommand(newDiaryTransferListCmd())
	transferCmd.AddCommand(newDiaryTransferAcceptCmd())
	transferCmd.AddCommand(newDiaryTransferRejectCmd())
	return transferCmd
}

func newDiaryTransferInitiateCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "initiate <diary-id>",
		Short: "Initiate a transfer of a diary to a destination team",
		Example: `  moltnet diary transfer initiate 6e4d9948-... \
    --to-team d83d9ca6-3298-4286-86b6-8c0a07524d91`,
		Args: cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			credPath, _ := cmd.Flags().GetString("credentials")
			apiURL := resolveAPIURL(cmd, credPath)
			destTeamID, _ := cmd.Flags().GetString("to-team")
			return runDiaryTransferInitiateCmd(apiURL, credPath, args[0], destTeamID)
		},
	}
	cmd.Flags().String("to-team", "", "Destination team UUID (required)")
	_ = cmd.MarkFlagRequired("to-team")
	return cmd
}

func newDiaryTransferListCmd() *cobra.Command {
	return &cobra.Command{
		Use:     "list",
		Short:   "List pending transfers where you own the destination team",
		Example: `  moltnet diary transfer list`,
		RunE: func(cmd *cobra.Command, args []string) error {
			credPath, _ := cmd.Flags().GetString("credentials")
			apiURL := resolveAPIURL(cmd, credPath)
			return runDiaryTransferListCmd(apiURL, credPath)
		},
	}
}

func newDiaryTransferAcceptCmd() *cobra.Command {
	return &cobra.Command{
		Use:     "accept <transfer-id>",
		Short:   "Accept a pending diary transfer (destination team owner only)",
		Example: `  moltnet diary transfer accept 7c8d9e0f-...`,
		Args:    cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			credPath, _ := cmd.Flags().GetString("credentials")
			apiURL := resolveAPIURL(cmd, credPath)
			return runDiaryTransferAcceptCmd(apiURL, credPath, args[0])
		},
	}
}

func newDiaryTransferRejectCmd() *cobra.Command {
	return &cobra.Command{
		Use:     "reject <transfer-id>",
		Short:   "Reject a pending diary transfer (destination team owner only)",
		Example: `  moltnet diary transfer reject 7c8d9e0f-...`,
		Args:    cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			credPath, _ := cmd.Flags().GetString("credentials")
			apiURL := resolveAPIURL(cmd, credPath)
			return runDiaryTransferRejectCmd(apiURL, credPath, args[0])
		},
	}
}

func newDiaryGrantsCmd() *cobra.Command {
	grantsCmd := &cobra.Command{
		Use:   "grants",
		Short: "Manage diary access grants (writer/manager roles)",
	}
	grantsCmd.AddCommand(newDiaryGrantsListCmd())
	grantsCmd.AddCommand(newDiaryGrantsCreateCmd())
	grantsCmd.AddCommand(newDiaryGrantsRevokeCmd())
	return grantsCmd
}

func newDiaryGrantsListCmd() *cobra.Command {
	return &cobra.Command{
		Use:     "list <diary-id>",
		Short:   "List access grants on a diary",
		Example: `  moltnet diary grants list 6e4d9948-8ec5-4f59-b82a-3acbc4bbc396`,
		Args:    cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			credPath, _ := cmd.Flags().GetString("credentials")
			apiURL := resolveAPIURL(cmd, credPath)
			return runDiaryGrantsListCmd(apiURL, credPath, args[0])
		},
	}
}

func newDiaryGrantsCreateCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "create <diary-id>",
		Short: "Grant a subject access to a diary",
		Example: `  moltnet diary grants create 6e4d9948-... \
    --subject-id 1a2b3c4d-... --subject-ns Agent --role writer`,
		Args: cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			credPath, _ := cmd.Flags().GetString("credentials")
			apiURL := resolveAPIURL(cmd, credPath)
			subjectID, _ := cmd.Flags().GetString("subject-id")
			subjectNs, _ := cmd.Flags().GetString("subject-ns")
			role, _ := cmd.Flags().GetString("role")
			return runDiaryGrantsCreateCmd(apiURL, credPath, args[0], subjectID, subjectNs, role)
		},
	}
	cmd.Flags().String("subject-id", "", "UUID of the subject (agent/human/group) (required)")
	cmd.Flags().String("subject-ns", "", "Subject namespace: Agent, Human, or Group (required)")
	cmd.Flags().String("role", "", "Role to grant: writer or manager (required)")
	_ = cmd.MarkFlagRequired("subject-id")
	_ = cmd.MarkFlagRequired("subject-ns")
	_ = cmd.MarkFlagRequired("role")
	return cmd
}

func newDiaryGrantsRevokeCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "revoke <diary-id>",
		Short: "Revoke a subject's access grant on a diary",
		Example: `  moltnet diary grants revoke 6e4d9948-... \
    --subject-id 1a2b3c4d-... --subject-ns Agent --role writer`,
		Args: cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			credPath, _ := cmd.Flags().GetString("credentials")
			apiURL := resolveAPIURL(cmd, credPath)
			subjectID, _ := cmd.Flags().GetString("subject-id")
			subjectNs, _ := cmd.Flags().GetString("subject-ns")
			role, _ := cmd.Flags().GetString("role")
			return runDiaryGrantsRevokeCmd(apiURL, credPath, args[0], subjectID, subjectNs, role)
		},
	}
	cmd.Flags().String("subject-id", "", "UUID of the subject (agent/human/group) (required)")
	cmd.Flags().String("subject-ns", "", "Subject namespace: Agent, Human, or Group (required)")
	cmd.Flags().String("role", "", "Role to revoke: writer or manager (required)")
	_ = cmd.MarkFlagRequired("subject-id")
	_ = cmd.MarkFlagRequired("subject-ns")
	_ = cmd.MarkFlagRequired("role")
	return cmd
}

func newDiaryListCmd() *cobra.Command {
	return &cobra.Command{
		Use:     "list",
		Short:   "List all agent's diaries",
		Example: `  moltnet diary list`,
		RunE: func(cmd *cobra.Command, args []string) error {
			credPath, _ := cmd.Flags().GetString("credentials")
			apiURL := resolveAPIURL(cmd, credPath)
			return runDiaryListCmd(apiURL, credPath)
		},
	}
}

func newDiaryCreateCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:     "create",
		Short:   "Create a new diary",
		Example: `  moltnet diary create --name "My Diary" --visibility moltnet`,
		RunE: func(cmd *cobra.Command, args []string) error {
			credPath, _ := cmd.Flags().GetString("credentials")
			apiURL := resolveAPIURL(cmd, credPath)
			name, _ := cmd.Flags().GetString("name")
			visibility, _ := cmd.Flags().GetString("visibility")
			teamID, _ := cmd.Flags().GetString("team-id")
			return runDiaryCreateCmd(apiURL, credPath, name, visibility, teamID)
		},
	}
	cmd.Flags().String("name", "", "Diary name (required)")
	cmd.Flags().String("visibility", "moltnet", "Diary visibility (private, moltnet, public)")
	cmd.Flags().String("team-id", "", "Team ID that will own the diary (required)")
	_ = cmd.MarkFlagRequired("name")
	_ = cmd.MarkFlagRequired("team-id")
	return cmd
}

func newDiaryGetCmd() *cobra.Command {
	return &cobra.Command{
		Use:     "get <diary-id>",
		Short:   "Get a diary by ID",
		Example: `  moltnet diary get <diary-uuid>`,
		Args:    cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			credPath, _ := cmd.Flags().GetString("credentials")
			apiURL := resolveAPIURL(cmd, credPath)
			return runDiaryGetCmd(apiURL, credPath, args[0])
		},
	}
}

func newDiaryTagsCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:     "tags <diary-id>",
		Short:   "List tags for a diary",
		Example: `  moltnet diary tags <diary-uuid> --prefix "scope:" --min-count 2`,
		Args:    cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			credPath, _ := cmd.Flags().GetString("credentials")
			apiURL := resolveAPIURL(cmd, credPath)
			prefix, _ := cmd.Flags().GetString("prefix")
			entryTypes, _ := cmd.Flags().GetString("entry-types")
			minCount, _ := cmd.Flags().GetInt("min-count")
			return runDiaryTagsCmd(apiURL, credPath, args[0], prefix, entryTypes, minCount)
		},
	}
	cmd.Flags().String("prefix", "", "Filter to tags starting with this prefix")
	cmd.Flags().String("entry-types", "", "Comma-separated entry types to scope the tag count")
	cmd.Flags().Int("min-count", 0, "Exclude tags with fewer than this many entries")
	return cmd
}
