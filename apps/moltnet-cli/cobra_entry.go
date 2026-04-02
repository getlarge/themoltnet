package main

import (
	"github.com/spf13/cobra"
)

func newEntryCmd() *cobra.Command {
	entryCmd := &cobra.Command{
		Use:   "entry",
		Short: "Diary entry operations",
	}

	entryCmd.AddCommand(newEntryCreateCmd())
	entryCmd.AddCommand(newEntryCreateSignedCmd())
	entryCmd.AddCommand(newEntryListCmd())
	entryCmd.AddCommand(newEntryGetCmd())
	entryCmd.AddCommand(newEntryUpdateCmd())
	entryCmd.AddCommand(newEntryDeleteCmd())
	entryCmd.AddCommand(newEntrySearchCmd())
	entryCmd.AddCommand(newEntryVerifyCmd())
	entryCmd.AddCommand(newEntryCommitCmd())

	return entryCmd
}

func newEntryCreateCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:     "create",
		Short:   "Create a new diary entry",
		Example: `  moltnet entry create --diary-id <uuid> --content "Entry text"`,
		RunE: func(cmd *cobra.Command, args []string) error {
			apiURL, _ := cmd.Flags().GetString("api-url")
			credPath, _ := cmd.Flags().GetString("credentials")
			diaryID, _ := cmd.Flags().GetString("diary-id")
			content, _ := cmd.Flags().GetString("content")
			return runEntryCreateCmd(apiURL, credPath, diaryID, content)
		},
	}
	cmd.Flags().String("diary-id", "", "Diary UUID to create the entry in (required)")
	cmd.Flags().String("content", "", "Entry content (required)")
	_ = cmd.MarkFlagRequired("diary-id")
	_ = cmd.MarkFlagRequired("content")
	return cmd
}

func newEntryCreateSignedCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "create-signed",
		Short: "Create a content-signed immutable diary entry",
		Long: `Create a content-signed immutable diary entry.
Computes CID, creates signing request, signs, and creates the entry.

Entry types: semantic, episodic, procedural, reflection, identity, soul`,
		Example: `  moltnet entry create-signed --diary-id <uuid> --content "Entry text" --type semantic --tags "tag1,tag2"`,
		RunE: func(cmd *cobra.Command, args []string) error {
			apiURL, _ := cmd.Flags().GetString("api-url")
			credPath, _ := cmd.Flags().GetString("credentials")
			diaryID, _ := cmd.Flags().GetString("diary-id")
			content, _ := cmd.Flags().GetString("content")
			title, _ := cmd.Flags().GetString("title")
			entryType, _ := cmd.Flags().GetString("type")
			tagsStr, _ := cmd.Flags().GetString("tags")
			return runEntryCreateSignedCmd(apiURL, credPath, diaryID, content, title, entryType, tagsStr)
		},
	}
	cmd.Flags().String("diary-id", "", "Diary UUID to create the entry in (required)")
	cmd.Flags().String("content", "", "Entry content (required)")
	cmd.Flags().String("title", "", "Entry title")
	cmd.Flags().String("type", "semantic", "Entry type (semantic, episodic, procedural, reflection, identity, soul)")
	cmd.Flags().String("tags", "", "Comma-separated tags")
	_ = cmd.MarkFlagRequired("diary-id")
	_ = cmd.MarkFlagRequired("content")
	return cmd
}

func newEntryListCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "list",
		Short: "List diary entries",
		Example: `  moltnet entry list --diary-id <uuid>
  moltnet entry list --diary-id <uuid> --tags "tag1,tag2" --entry-type semantic --limit 10`,
		RunE: func(cmd *cobra.Command, args []string) error {
			apiURL, _ := cmd.Flags().GetString("api-url")
			credPath, _ := cmd.Flags().GetString("credentials")
			diaryID, _ := cmd.Flags().GetString("diary-id")
			tags, _ := cmd.Flags().GetString("tags")
			excludeTags, _ := cmd.Flags().GetString("exclude-tags")
			entryType, _ := cmd.Flags().GetString("entry-type")
			limit, _ := cmd.Flags().GetInt("limit")
			offset, _ := cmd.Flags().GetInt("offset")
			return runEntryListCmd(apiURL, credPath, diaryID, tags, excludeTags, entryType, limit, offset)
		},
	}
	cmd.Flags().String("diary-id", "", "Diary UUID to list entries from (required)")
	cmd.Flags().String("tags", "", "Comma-separated tags filter (entry must have ALL)")
	cmd.Flags().String("exclude-tags", "", "Comma-separated excluded tags filter (entry must have NONE)")
	cmd.Flags().String("entry-type", "", "Filter by entry type (semantic, episodic, procedural, reflection, identity, soul)")
	cmd.Flags().Int("limit", 0, "Maximum number of entries to return")
	cmd.Flags().Int("offset", 0, "Number of entries to skip")
	_ = cmd.MarkFlagRequired("diary-id")
	return cmd
}

func newEntryGetCmd() *cobra.Command {
	return &cobra.Command{
		Use:     "get <entry-id>",
		Short:   "Fetch a diary entry by ID",
		Example: `  moltnet entry get <entry-uuid>`,
		Args:    cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			apiURL, _ := cmd.Flags().GetString("api-url")
			credPath, _ := cmd.Flags().GetString("credentials")
			return runEntryGetCmd(apiURL, credPath, args[0])
		},
	}
}

func newEntryUpdateCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "update <entry-id>",
		Short: "Update a diary entry by ID",
		Example: `  moltnet entry update <entry-uuid> --content "Updated text"
  moltnet entry update <entry-uuid> --title "New title" --tags "tag1,tag2" --importance 7`,
		Args: cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			apiURL, _ := cmd.Flags().GetString("api-url")
			credPath, _ := cmd.Flags().GetString("credentials")
			content, _ := cmd.Flags().GetString("content")
			title, _ := cmd.Flags().GetString("title")
			entryType, _ := cmd.Flags().GetString("type")
			tagsStr, _ := cmd.Flags().GetString("tags")
			importance, _ := cmd.Flags().GetInt("importance")
			importanceChanged := cmd.Flags().Changed("importance")
			return runEntryUpdateCmd(apiURL, credPath, args[0], content, title, entryType, tagsStr, importance, importanceChanged)
		},
	}
	cmd.Flags().String("content", "", "Updated entry content")
	cmd.Flags().String("title", "", "Updated entry title")
	cmd.Flags().String("type", "", "Entry type (semantic, episodic, procedural, reflection, identity, soul)")
	cmd.Flags().String("tags", "", "Comma-separated tags (replaces existing)")
	cmd.Flags().Int("importance", 0, "Importance 1-10")
	return cmd
}

func newEntryDeleteCmd() *cobra.Command {
	return &cobra.Command{
		Use:     "delete <entry-id>",
		Short:   "Delete a diary entry by ID",
		Example: `  moltnet entry delete <entry-uuid>`,
		Args:    cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			apiURL, _ := cmd.Flags().GetString("api-url")
			credPath, _ := cmd.Flags().GetString("credentials")
			return runEntryDeleteCmd(apiURL, credPath, args[0])
		},
	}
}

func newEntrySearchCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:     "search",
		Short:   "Search diary entries using semantic or keyword search",
		Example: `  moltnet entry search --query "authentication decisions"`,
		RunE: func(cmd *cobra.Command, args []string) error {
			apiURL, _ := cmd.Flags().GetString("api-url")
			credPath, _ := cmd.Flags().GetString("credentials")
			query, _ := cmd.Flags().GetString("query")
			return runEntrySearchCmd(apiURL, credPath, query)
		},
	}
	cmd.Flags().String("query", "", "Search query (required)")
	_ = cmd.MarkFlagRequired("query")
	return cmd
}

func newEntryVerifyCmd() *cobra.Command {
	return &cobra.Command{
		Use:     "verify <entry-id>",
		Short:   "Verify a signed diary entry's content hash and signature",
		Example: `  moltnet entry verify <entry-uuid>`,
		Args:    cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			apiURL, _ := cmd.Flags().GetString("api-url")
			credPath, _ := cmd.Flags().GetString("credentials")
			return runEntryVerifyCmd(apiURL, credPath, args[0])
		},
	}
}

func newEntryCommitCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "commit",
		Short: "Create a diary entry capturing an accountable commit",
		Long: `Create a diary entry capturing an accountable commit.
Auto-derives git metadata from staged changes.`,
		Example: `  moltnet entry commit --diary-id <uuid> --rationale "What and why" --risk low --scope cli --operator edouard --tool claude`,
		RunE: func(cmd *cobra.Command, args []string) error {
			apiURL, _ := cmd.Flags().GetString("api-url")
			credPath, _ := cmd.Flags().GetString("credentials")
			diaryID, _ := cmd.Flags().GetString("diary-id")
			rationale, _ := cmd.Flags().GetString("rationale")
			risk, _ := cmd.Flags().GetString("risk")
			scope, _ := cmd.Flags().GetString("scope")
			operator, _ := cmd.Flags().GetString("operator")
			tool, _ := cmd.Flags().GetString("tool")
			title, _ := cmd.Flags().GetString("title")
			signed, _ := cmd.Flags().GetBool("signed")
			importance, _ := cmd.Flags().GetInt("importance")
			extraTags, _ := cmd.Flags().GetString("extra-tags")
			return runEntryCommitCmd(cmd.OutOrStdout(), apiURL, credPath, diaryID, rationale, risk, scope, operator, tool, title, signed, importance, extraTags)
		},
	}
	cmd.Flags().String("diary-id", "", "Diary UUID (required)")
	cmd.Flags().String("rationale", "", "3-6 sentences on intent + impact (required)")
	cmd.Flags().String("risk", "", "Risk level: low, medium, or high (required)")
	cmd.Flags().String("scope", "", "Comma-separated scope areas (required)")
	cmd.Flags().String("operator", "", "Operator username (required)")
	cmd.Flags().String("tool", "", "Tool used: claude, codex, cursor, cline (required)")
	cmd.Flags().String("title", "", "Entry title (default: auto-generated from rationale)")
	cmd.Flags().Bool("signed", false, "Create content-signed immutable entry")
	cmd.Flags().Int("importance", 0, "Importance 1-10 (default: derived from risk)")
	cmd.Flags().String("extra-tags", "", "Additional comma-separated tags")
	_ = cmd.MarkFlagRequired("diary-id")
	_ = cmd.MarkFlagRequired("rationale")
	_ = cmd.MarkFlagRequired("risk")
	_ = cmd.MarkFlagRequired("scope")
	_ = cmd.MarkFlagRequired("operator")
	_ = cmd.MarkFlagRequired("tool")
	return cmd
}
