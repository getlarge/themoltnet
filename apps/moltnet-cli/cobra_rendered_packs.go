package main

import (
	"fmt"

	"github.com/spf13/cobra"
)

func newRenderedPacksCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "rendered-packs",
		Short: "Manage rendered context packs",
	}
	cmd.AddCommand(newRenderedPacksListCmd())
	cmd.AddCommand(newRenderedPacksGetCmd())
	cmd.AddCommand(newRenderedPacksUpdateCmd())
	cmd.AddCommand(newRenderedPacksVerifyCmd())
	cmd.AddCommand(newRenderedPacksJudgeCmd())
	return cmd
}

func newRenderedPacksListCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "list",
		Short: "List rendered packs for a diary",
		Example: `  moltnet rendered-packs list --diary-id <uuid>
  moltnet rendered-packs list --diary-id <uuid> --source-pack-id <uuid>
  moltnet rendered-packs list --diary-id <uuid> --render-method agent-refined --limit 10`,
		RunE: func(cmd *cobra.Command, args []string) error {
			apiURL, _ := cmd.Flags().GetString("api-url")
			credPath, _ := cmd.Flags().GetString("credentials")
			diaryID, _ := cmd.Flags().GetString("diary-id")
			limit, _ := cmd.Flags().GetInt("limit")
			offset, _ := cmd.Flags().GetInt("offset")
			sourcePackID, _ := cmd.Flags().GetString("source-pack-id")
			renderMethod, _ := cmd.Flags().GetString("render-method")
			return runRenderedPacksList(apiURL, credPath, diaryID, limit, offset, sourcePackID, renderMethod)
		},
	}
	cmd.Flags().String("diary-id", "", "Diary UUID (required)")
	cmd.Flags().Int("limit", 0, "Maximum number of rendered packs to return")
	cmd.Flags().Int("offset", 0, "Number of rendered packs to skip")
	cmd.Flags().String("source-pack-id", "", "Filter by source pack UUID")
	cmd.Flags().String("render-method", "", "Filter by render method label")
	_ = cmd.MarkFlagRequired("diary-id")
	return cmd
}

func newRenderedPacksGetCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:     "get",
		Short:   "Get a rendered pack by ID",
		Example: `  moltnet rendered-packs get --id <rendered-pack-uuid>`,
		RunE: func(cmd *cobra.Command, args []string) error {
			apiURL, _ := cmd.Flags().GetString("api-url")
			credPath, _ := cmd.Flags().GetString("credentials")
			id, _ := cmd.Flags().GetString("id")
			return runRenderedPacksGet(apiURL, credPath, id)
		},
	}
	cmd.Flags().String("id", "", "Rendered pack UUID (required)")
	_ = cmd.MarkFlagRequired("id")
	return cmd
}

func newRenderedPacksUpdateCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "update",
		Short: "Update a rendered pack",
		Long:  `Update a rendered pack's pinned status or expiration time.`,
		Example: `  moltnet rendered-packs update --id <uuid> --pinned
  moltnet rendered-packs update --id <uuid> --no-pinned --expires-at 2026-05-01T00:00:00Z
  moltnet rendered-packs update --id <uuid> --expires-at 2026-05-01T00:00:00Z`,
		RunE: func(cmd *cobra.Command, args []string) error {
			apiURL, _ := cmd.Flags().GetString("api-url")
			credPath, _ := cmd.Flags().GetString("credentials")
			id, _ := cmd.Flags().GetString("id")
			expiresAt, _ := cmd.Flags().GetString("expires-at")

			var pinned *bool
			if cmd.Flags().Changed("pinned") {
				v := true
				pinned = &v
			} else if cmd.Flags().Changed("no-pinned") {
				v := false
				pinned = &v
			}

			if pinned == nil && expiresAt == "" {
				return fmt.Errorf("at least one of --pinned, --no-pinned, or --expires-at must be provided")
			}

			return runRenderedPacksUpdate(apiURL, credPath, id, pinned, expiresAt)
		},
	}
	cmd.Flags().String("id", "", "Rendered pack UUID (required)")
	cmd.Flags().Bool("pinned", false, "Pin the rendered pack")
	cmd.Flags().Bool("no-pinned", false, "Unpin the rendered pack")
	cmd.Flags().String("expires-at", "", "Expiration time in RFC3339 format")
	_ = cmd.MarkFlagRequired("id")
	cmd.MarkFlagsMutuallyExclusive("pinned", "no-pinned")
	return cmd
}
