package main

import (
	"fmt"

	"github.com/spf13/cobra"
)

func newRenderedPacksCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "rendered-pack",
		Short: "Manage rendered context packs",
	}
	cmd.AddCommand(newRenderedPacksListCmd())
	cmd.AddCommand(newRenderedPacksGetCmd())
	cmd.AddCommand(newRenderedPacksUpdateCmd())
	cmd.AddCommand(newRenderedPacksJudgeCmd())
	cmd.AddCommand(newRenderedPackToSkillCmd())
	return cmd
}

func newRenderedPackToSkillCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "to-skill",
		Short: "Convert a rendered pack into an AgentSkills SKILL.md bundle",
		Long: `Fetch a rendered pack by UUID and write an AgentSkills-conformant
SKILL.md to <out>/<slug>/SKILL.md. The frontmatter carries identity fields
under the moltnet: namespace (rendered_pack_id, rendered_pack_cid,
source_pack_id, bundled_at) so re-runs detect updates without an external
sidecar file. Idempotent on the same rendered pack ID; errors on slug
collision against a different ID.`,
		Example: `  moltnet rendered-pack to-skill --id <rendered-pack-uuid> --out .claude/skills
  moltnet rendered-pack to-skill --id <rendered-pack-uuid> --out .codex/skills`,
		RunE: func(cmd *cobra.Command, args []string) error {
			apiURL, _ := cmd.Flags().GetString("api-url")
			credPath, _ := cmd.Flags().GetString("credentials")
			id, _ := cmd.Flags().GetString("id")
			out, _ := cmd.Flags().GetString("out")
			return runRenderedPackToSkill(apiURL, credPath, id, out)
		},
	}
	cmd.Flags().String("id", "", "Rendered pack UUID (required)")
	cmd.Flags().String("out", "", "Output directory; SKILL.md is written to <out>/<slug>/SKILL.md (required)")
	_ = cmd.MarkFlagRequired("id")
	_ = cmd.MarkFlagRequired("out")
	return cmd
}

func newRenderedPacksListCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "list",
		Short: "List rendered packs for a diary",
		Example: `  moltnet rendered-pack list --diary-id <uuid>
  moltnet rendered-pack list --diary-id <uuid> --source-pack-id <uuid>
  moltnet rendered-pack list --diary-id <uuid> --render-method agent-refined --limit 10`,
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
		Example: `  moltnet rendered-pack get --id <rendered-pack-uuid>`,
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
		Example: `  moltnet rendered-pack update --id <uuid> --pinned
  moltnet rendered-pack update --id <uuid> --no-pinned --expires-at 2026-05-01T00:00:00Z
  moltnet rendered-pack update --id <uuid> --expires-at 2026-05-01T00:00:00Z`,
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
