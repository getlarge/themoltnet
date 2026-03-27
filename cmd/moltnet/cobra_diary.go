package main

import (
	"encoding/json"
	"fmt"
	"io"
	"os"

	"github.com/google/uuid"
	"github.com/spf13/cobra"
)

func newDiaryCmd() *cobra.Command {
	diaryCmd := &cobra.Command{
		Use:   "diary",
		Short: "Diary entry management commands",
	}

	diaryCmd.AddCommand(newDiaryCreateCmd())
	diaryCmd.AddCommand(newDiaryCreateSignedCmd())
	diaryCmd.AddCommand(newDiaryListCmd())
	diaryCmd.AddCommand(newDiaryGetCmd())
	diaryCmd.AddCommand(newDiaryDeleteCmd())
	diaryCmd.AddCommand(newDiarySearchCmd())
	diaryCmd.AddCommand(newDiaryVerifyCmd())
	diaryCmd.AddCommand(newDiaryCommitCmd())

	return diaryCmd
}

func newDiaryCreateCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "create",
		Short: "Create a new diary entry",
		Example: `  moltnet diary create --diary-id <uuid> --content "Entry text"`,
		RunE: func(cmd *cobra.Command, args []string) error {
			apiURL, _ := cmd.Flags().GetString("api-url")
			credPath, _ := cmd.Flags().GetString("credentials")
			diaryID, _ := cmd.Flags().GetString("diary-id")
			content, _ := cmd.Flags().GetString("content")
			return runDiaryCreateCmd(apiURL, credPath, diaryID, content)
		},
	}
	cmd.Flags().String("diary-id", "", "Diary UUID to create the entry in (required)")
	cmd.Flags().String("content", "", "Entry content (required)")
	_ = cmd.MarkFlagRequired("diary-id")
	_ = cmd.MarkFlagRequired("content")
	return cmd
}

func newDiaryCreateSignedCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "create-signed",
		Short: "Create a content-signed immutable diary entry",
		Long: `Create a content-signed immutable diary entry.
Computes CID, creates signing request, signs, and creates the entry.

Entry types: semantic, episodic, procedural, reflection, identity, soul`,
		Example: `  moltnet diary create-signed --diary-id <uuid> --content "Entry text" --type semantic --tags "tag1,tag2"`,
		RunE: func(cmd *cobra.Command, args []string) error {
			apiURL, _ := cmd.Flags().GetString("api-url")
			credPath, _ := cmd.Flags().GetString("credentials")
			diaryID, _ := cmd.Flags().GetString("diary-id")
			content, _ := cmd.Flags().GetString("content")
			title, _ := cmd.Flags().GetString("title")
			entryType, _ := cmd.Flags().GetString("type")
			tagsStr, _ := cmd.Flags().GetString("tags")
			return runDiaryCreateSignedCmd(apiURL, credPath, diaryID, content, title, entryType, tagsStr)
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

func newDiaryListCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:     "list",
		Short:   "List diary entries",
		Example: `  moltnet diary list --diary-id <uuid>`,
		RunE: func(cmd *cobra.Command, args []string) error {
			apiURL, _ := cmd.Flags().GetString("api-url")
			credPath, _ := cmd.Flags().GetString("credentials")
			diaryID, _ := cmd.Flags().GetString("diary-id")
			return runDiaryListCmd(apiURL, credPath, diaryID)
		},
	}
	cmd.Flags().String("diary-id", "", "Diary UUID to list entries from (required)")
	_ = cmd.MarkFlagRequired("diary-id")
	return cmd
}

func newDiaryGetCmd() *cobra.Command {
	return &cobra.Command{
		Use:     "get <entry-id>",
		Short:   "Fetch a diary entry by ID",
		Example: `  moltnet diary get <entry-uuid>`,
		Args:    cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			apiURL, _ := cmd.Flags().GetString("api-url")
			credPath, _ := cmd.Flags().GetString("credentials")
			return runDiaryGetCmd(apiURL, credPath, args[0])
		},
	}
}

func newDiaryDeleteCmd() *cobra.Command {
	return &cobra.Command{
		Use:     "delete <entry-id>",
		Short:   "Delete a diary entry by ID",
		Example: `  moltnet diary delete <entry-uuid>`,
		Args:    cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			apiURL, _ := cmd.Flags().GetString("api-url")
			credPath, _ := cmd.Flags().GetString("credentials")
			return runDiaryDeleteCmd(apiURL, credPath, args[0])
		},
	}
}

func newDiarySearchCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:     "search",
		Short:   "Search diary entries using semantic or keyword search",
		Example: `  moltnet diary search --query "authentication decisions"`,
		RunE: func(cmd *cobra.Command, args []string) error {
			apiURL, _ := cmd.Flags().GetString("api-url")
			credPath, _ := cmd.Flags().GetString("credentials")
			query, _ := cmd.Flags().GetString("query")
			return runDiarySearchCmd(apiURL, credPath, query)
		},
	}
	cmd.Flags().String("query", "", "Search query (required)")
	_ = cmd.MarkFlagRequired("query")
	return cmd
}

func newDiaryVerifyCmd() *cobra.Command {
	return &cobra.Command{
		Use:     "verify <entry-id>",
		Short:   "Verify a signed diary entry's content hash and signature",
		Example: `  moltnet diary verify <entry-uuid>`,
		Args:    cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			apiURL, _ := cmd.Flags().GetString("api-url")
			credPath, _ := cmd.Flags().GetString("credentials")
			return runDiaryVerifyCmd(apiURL, credPath, args[0])
		},
	}
}

func newDiaryCommitCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "commit",
		Short: "Create a diary entry capturing an accountable commit",
		Long: `Create a diary entry capturing an accountable commit.
Auto-derives git metadata from staged changes.`,
		Example: `  moltnet diary commit --diary-id <uuid> --rationale "What and why" --risk low --scope cli --operator edouard --tool claude`,
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
			return runDiaryCommitCmd(cmd.OutOrStdout(), apiURL, credPath, diaryID, rationale, risk, scope, operator, tool, title, signed, importance, extraTags)
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

// runDiaryCommitCmd is the parameterized business logic for diary commit.
func runDiaryCommitCmd(w io.Writer, apiURL, credPath, diaryID, rationale, risk, scope, operator, tool, title string, signed bool, importance int, extraTags string) error {
	if err := validateCommitFlags(diaryID, rationale, risk, scope, operator, tool, importance); err != nil {
		return err
	}

	diaryUUID, _ := uuid.Parse(diaryID) // already validated

	imp := importance
	if imp == 0 {
		imp = deriveImportance(risk)
	}

	scopes := splitAndTrim(scope, ",")
	if len(scopes) == 0 {
		return fmt.Errorf("flag --scope must contain at least one non-empty scope")
	}
	var extraTagsList []string
	if extraTags != "" {
		extraTagsList = splitAndTrim(extraTags, ",")
	}

	fmt.Fprintln(os.Stderr, "Extracting git metadata...")
	meta, err := extractGitMeta()
	if err != nil {
		return err
	}
	fmt.Fprintf(os.Stderr, "Branch: %s, files changed: %d\n", meta.Branch, meta.FilesChanged)

	creds, err := loadCredentials(credPath)
	if err != nil {
		return err
	}

	payload := buildCommitPayload(rationale, meta, creds.Keys.Fingerprint, operator, tool, risk, scopes)
	tags := buildCommitTags(risk, meta.Branch, scopes, extraTagsList)

	entryTitle := title
	if entryTitle == "" {
		entryTitle = "Accountable commit: " + firstSentence(rationale)
	}

	if creds.OAuth2.ClientID == "" || creds.OAuth2.ClientSecret == "" {
		return fmt.Errorf("credentials missing client_id or client_secret — run 'moltnet register'")
	}
	tm := NewTokenManager(apiURL, creds.OAuth2.ClientID, creds.OAuth2.ClientSecret)
	client, err := newAuthedClient(apiURL, tm)
	if err != nil {
		return err
	}

	fmt.Fprintln(os.Stderr, "Creating diary entry...")
	result, err := signAndCreateEntry(client, creds, payload, diaryUUID, entryTitle, tags, imp, signed)
	if err != nil {
		return err
	}

	return json.NewEncoder(w).Encode(result)
}
