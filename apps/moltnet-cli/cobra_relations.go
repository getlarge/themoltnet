package main

import (
	"github.com/spf13/cobra"
)

func newRelationsCmd() *cobra.Command {
	relCmd := &cobra.Command{
		Use:   "relations",
		Short: "Manage entry relations",
	}

	relCmd.AddCommand(newRelationsCreateCmd())
	relCmd.AddCommand(newRelationsListCmd())
	relCmd.AddCommand(newRelationsUpdateCmd())
	relCmd.AddCommand(newRelationsDeleteCmd())

	return relCmd
}

func newRelationsCreateCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "create",
		Short: "Create a relation between two diary entries",
		Example: `  moltnet relations create --entry-id <uuid> --target-id <uuid> --relation supersedes
  moltnet relations create --entry-id <uuid> --target-id <uuid> --relation elaborates --status proposed`,
		RunE: func(cmd *cobra.Command, args []string) error {
			apiURL, _ := cmd.Flags().GetString("api-url")
			credPath, _ := cmd.Flags().GetString("credentials")
			entryID, _ := cmd.Flags().GetString("entry-id")
			targetID, _ := cmd.Flags().GetString("target-id")
			relation, _ := cmd.Flags().GetString("relation")
			status, _ := cmd.Flags().GetString("status")
			return runRelationsCreateCmd(apiURL, credPath, entryID, targetID, relation, status)
		},
	}
	cmd.Flags().String("entry-id", "", "Source entry UUID (required)")
	cmd.Flags().String("target-id", "", "Target entry UUID (required)")
	cmd.Flags().String("relation", "", "Relation type: supersedes, elaborates, contradicts, supports, caused_by, references (required)")
	cmd.Flags().String("status", "", "Initial status: proposed, accepted (default: server default)")
	_ = cmd.MarkFlagRequired("entry-id")
	_ = cmd.MarkFlagRequired("target-id")
	_ = cmd.MarkFlagRequired("relation")
	return cmd
}

func newRelationsListCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "list",
		Short: "List relations for a diary entry",
		Example: `  moltnet relations list --entry-id <uuid>
  moltnet relations list --entry-id <uuid> --relation supersedes --status accepted --direction as_source --limit 20`,
		RunE: func(cmd *cobra.Command, args []string) error {
			apiURL, _ := cmd.Flags().GetString("api-url")
			credPath, _ := cmd.Flags().GetString("credentials")
			entryID, _ := cmd.Flags().GetString("entry-id")
			relation, _ := cmd.Flags().GetString("relation")
			status, _ := cmd.Flags().GetString("status")
			direction, _ := cmd.Flags().GetString("direction")
			limit, _ := cmd.Flags().GetInt("limit")
			return runRelationsListCmd(apiURL, credPath, entryID, relation, status, direction, limit)
		},
	}
	cmd.Flags().String("entry-id", "", "Entry UUID to list relations for (required)")
	cmd.Flags().String("relation", "", "Filter by relation type: supersedes, elaborates, contradicts, supports, caused_by, references")
	cmd.Flags().String("status", "", "Filter by status: proposed, accepted, rejected")
	cmd.Flags().String("direction", "", "Filter by direction: as_source, as_target, both")
	cmd.Flags().Int("limit", 0, "Maximum number of relations to return")
	_ = cmd.MarkFlagRequired("entry-id")
	return cmd
}

func newRelationsUpdateCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "update",
		Short: "Update a relation's status",
		Example: `  moltnet relations update --relation-id <uuid> --status accepted
  moltnet relations update --relation-id <uuid> --status rejected`,
		RunE: func(cmd *cobra.Command, args []string) error {
			apiURL, _ := cmd.Flags().GetString("api-url")
			credPath, _ := cmd.Flags().GetString("credentials")
			relationID, _ := cmd.Flags().GetString("relation-id")
			status, _ := cmd.Flags().GetString("status")
			return runRelationsUpdateCmd(apiURL, credPath, relationID, status)
		},
	}
	cmd.Flags().String("relation-id", "", "Relation UUID to update (required)")
	cmd.Flags().String("status", "", "New status: proposed, accepted, rejected (required)")
	_ = cmd.MarkFlagRequired("relation-id")
	_ = cmd.MarkFlagRequired("status")
	return cmd
}

func newRelationsDeleteCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:     "delete",
		Short:   "Delete a relation by ID",
		Example: `  moltnet relations delete --relation-id <uuid>`,
		RunE: func(cmd *cobra.Command, args []string) error {
			apiURL, _ := cmd.Flags().GetString("api-url")
			credPath, _ := cmd.Flags().GetString("credentials")
			relationID, _ := cmd.Flags().GetString("relation-id")
			return runRelationsDeleteCmd(apiURL, credPath, relationID)
		},
	}
	cmd.Flags().String("relation-id", "", "Relation UUID to delete (required)")
	_ = cmd.MarkFlagRequired("relation-id")
	return cmd
}
