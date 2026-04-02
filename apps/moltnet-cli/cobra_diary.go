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
	diaryCmd.AddCommand(newDiaryCompileCmd())

	return diaryCmd
}

func newDiaryListCmd() *cobra.Command {
	return &cobra.Command{
		Use:     "list",
		Short:   "List all agent's diaries",
		Example: `  moltnet diary list`,
		RunE: func(cmd *cobra.Command, args []string) error {
			apiURL, _ := cmd.Flags().GetString("api-url")
			credPath, _ := cmd.Flags().GetString("credentials")
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
			apiURL, _ := cmd.Flags().GetString("api-url")
			credPath, _ := cmd.Flags().GetString("credentials")
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
			apiURL, _ := cmd.Flags().GetString("api-url")
			credPath, _ := cmd.Flags().GetString("credentials")
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
			apiURL, _ := cmd.Flags().GetString("api-url")
			credPath, _ := cmd.Flags().GetString("credentials")
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

func newDiaryCompileCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "compile <diary-id>",
		Short: "Compile a context pack from a diary",
		Example: `  moltnet diary compile <diary-uuid> --token-budget 4000
  moltnet diary compile <diary-uuid> --token-budget 8000 --task-prompt "Summarize auth decisions" --include-tags "auth"`,
		Args: cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			apiURL, _ := cmd.Flags().GetString("api-url")
			credPath, _ := cmd.Flags().GetString("credentials")
			tokenBudget, _ := cmd.Flags().GetInt("token-budget")
			taskPrompt, _ := cmd.Flags().GetString("task-prompt")
			includeTags, _ := cmd.Flags().GetString("include-tags")
			excludeTags, _ := cmd.Flags().GetString("exclude-tags")
			entryTypes, _ := cmd.Flags().GetString("entry-types")
			createdAfter, _ := cmd.Flags().GetString("created-after")
			createdBefore, _ := cmd.Flags().GetString("created-before")
			wRecency, _ := cmd.Flags().GetFloat64("w-recency")
			wImportance, _ := cmd.Flags().GetFloat64("w-importance")
			lambda, _ := cmd.Flags().GetFloat64("lambda")
			wRecencyChanged := cmd.Flags().Changed("w-recency")
			wImportanceChanged := cmd.Flags().Changed("w-importance")
			lambdaChanged := cmd.Flags().Changed("lambda")
			return runDiaryCompileCmd(apiURL, credPath, args[0], tokenBudget, taskPrompt,
				includeTags, excludeTags, entryTypes, createdAfter, createdBefore,
				wRecency, wImportance, lambda, wRecencyChanged, wImportanceChanged, lambdaChanged)
		},
	}
	cmd.Flags().Int("token-budget", 0, "Token budget for the context pack (required)")
	cmd.Flags().String("task-prompt", "", "Task prompt to guide compilation")
	cmd.Flags().String("include-tags", "", "Comma-separated tags to include")
	cmd.Flags().String("exclude-tags", "", "Comma-separated tags to exclude")
	cmd.Flags().String("entry-types", "", "Comma-separated entry types to include")
	cmd.Flags().String("created-after", "", "Include entries created after this RFC3339 timestamp")
	cmd.Flags().String("created-before", "", "Include entries created before this RFC3339 timestamp")
	cmd.Flags().Float64("w-recency", 0, "Weight for recency scoring")
	cmd.Flags().Float64("w-importance", 0, "Weight for importance scoring")
	cmd.Flags().Float64("lambda", 0, "Lambda parameter for scoring")
	_ = cmd.MarkFlagRequired("token-budget")
	return cmd
}
