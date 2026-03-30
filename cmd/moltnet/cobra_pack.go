package main

import (
	"fmt"

	"github.com/spf13/cobra"
)

func newPackCmd() *cobra.Command {
	packCmd := &cobra.Command{
		Use:   "pack",
		Short: "Context pack commands",
	}

	packCmd.AddCommand(newPackExportCmd())
	packCmd.AddCommand(newPackRenderCmd())
	packCmd.AddCommand(newPackProvenanceCmd())
	packCmd.AddCommand(newPackCreateCmd())
	packCmd.AddCommand(newPackUpdateCmd())

	return packCmd
}

func newPackExportCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "export <pack-uuid>",
		Short: "Export a context pack as markdown",
		Long: `Export a context pack as markdown. The pack ID must be a UUID (not a CID).
Use 'moltnet pack list' or the MCP packs_list tool to find pack UUIDs.`,
		Example: `  moltnet pack export <pack-uuid>
  moltnet pack export --out pack.md <pack-uuid>`,
		Args: cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			apiURL, _ := cmd.Flags().GetString("api-url")
			credPath, _ := cmd.Flags().GetString("credentials")
			out, _ := cmd.Flags().GetString("out")
			return runPackExportCmd(apiURL, credPath, args[0], out)
		},
	}
	cmd.Flags().String("out", "", "Output file path (default: stdout)")
	return cmd
}

func newPackRenderCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "render <pack-uuid>",
		Short: "Render a context pack to structured markdown",
		Long: `Render a context pack to structured markdown. By default, fetches the
pack, renders it locally, and persists the rendered pack via the API.
Use --preview to return the rendered markdown without persisting.`,
		Example: `  moltnet pack render <pack-uuid>
  moltnet pack render --preview <pack-uuid>
  moltnet pack render --pinned <pack-uuid>
  moltnet pack render --render-method agent-refined <pack-uuid>
  moltnet pack render --out rendered.md --preview <pack-uuid>`,
		Args: cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			apiURL, _ := cmd.Flags().GetString("api-url")
			credPath, _ := cmd.Flags().GetString("credentials")
			renderMethod, _ := cmd.Flags().GetString("render-method")
			preview, _ := cmd.Flags().GetBool("preview")
			out, _ := cmd.Flags().GetString("out")

			var pinned *bool
			if cmd.Flags().Changed("pinned") {
				v, _ := cmd.Flags().GetBool("pinned")
				pinned = &v
			}

			return runPackRenderCmd(apiURL, credPath, args[0], renderMethod, preview, pinned, out)
		},
	}
	cmd.Flags().String("render-method", "pack-to-docs-v1", "Render method label")
	cmd.Flags().Bool("preview", false, "Preview without persisting")
	cmd.Flags().Bool("pinned", false, "Pin the rendered pack")
	cmd.Flags().String("out", "", "Output file path (default: stdout)")
	return cmd
}

func newPackCreateCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "create",
		Short: "Create a custom context pack for a diary",
		Long: `Create a custom context pack by specifying diary entries and their ranks.
The --entries flag takes a JSON array of objects with entryId and rank fields.`,
		Example: fmt.Sprintf(`  moltnet pack create --diary-id <uuid> --entries '%s'
  moltnet pack create --diary-id <uuid> --entries '%s' --token-budget 4096 --pinned`,
			`[{"entryId":"<uuid>","rank":1}]`,
			`[{"entryId":"<uuid>","rank":1},{"entryId":"<uuid>","rank":2}]`),
		RunE: func(cmd *cobra.Command, args []string) error {
			apiURL, _ := cmd.Flags().GetString("api-url")
			credPath, _ := cmd.Flags().GetString("credentials")
			diaryID, _ := cmd.Flags().GetString("diary-id")
			entries, _ := cmd.Flags().GetString("entries")
			tokenBudget, _ := cmd.Flags().GetInt("token-budget")

			var pinned *bool
			if cmd.Flags().Changed("pinned") {
				v := true
				pinned = &v
			}

			return runPackCreateCmd(apiURL, credPath, diaryID, entries, tokenBudget, pinned)
		},
	}
	cmd.Flags().String("diary-id", "", "Diary UUID (required)")
	cmd.Flags().String("entries", "", `JSON array of entries: [{"entryId":"<uuid>","rank":1}]`)
	cmd.Flags().Int("token-budget", 0, "Token budget for the pack")
	cmd.Flags().Bool("pinned", false, "Pin the pack")
	_ = cmd.MarkFlagRequired("diary-id")
	_ = cmd.MarkFlagRequired("entries")
	return cmd
}

func newPackUpdateCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "update",
		Short: "Update a context pack",
		Long:  `Update a context pack's pinned status or expiration time.`,
		Example: `  moltnet pack update --pack-id <uuid> --pinned
  moltnet pack update --pack-id <uuid> --no-pinned
  moltnet pack update --pack-id <uuid> --expires-at 2026-04-01T00:00:00Z`,
		RunE: func(cmd *cobra.Command, args []string) error {
			apiURL, _ := cmd.Flags().GetString("api-url")
			credPath, _ := cmd.Flags().GetString("credentials")
			packID, _ := cmd.Flags().GetString("pack-id")
			expiresAt, _ := cmd.Flags().GetString("expires-at")

			var pinned *bool
			if cmd.Flags().Changed("pinned") {
				v := true
				pinned = &v
			} else if cmd.Flags().Changed("no-pinned") {
				v := false
				pinned = &v
			}

			return runPackUpdateCmd(apiURL, credPath, packID, pinned, expiresAt)
		},
	}
	cmd.Flags().String("pack-id", "", "Pack UUID (required)")
	cmd.Flags().Bool("pinned", false, "Pin the pack")
	cmd.Flags().Bool("no-pinned", false, "Unpin the pack")
	cmd.Flags().String("expires-at", "", "Expiration time in RFC3339 format")
	_ = cmd.MarkFlagRequired("pack-id")
	return cmd
}

func newPackProvenanceCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "provenance",
		Short: "Export the provenance graph for a context pack as JSON",
		Long: `Export the provenance graph for a context pack as JSON.
Provide exactly one of --pack-id or --pack-cid.`,
		Example: `  moltnet pack provenance --pack-id <uuid>
  moltnet pack provenance --pack-cid <cid> --share-url https://themolt.net/labs/provenance`,
		RunE: func(cmd *cobra.Command, args []string) error {
			apiURL, _ := cmd.Flags().GetString("api-url")
			credPath, _ := cmd.Flags().GetString("credentials")
			packID, _ := cmd.Flags().GetString("pack-id")
			packCID, _ := cmd.Flags().GetString("pack-cid")
			depth, _ := cmd.Flags().GetInt("depth")
			out, _ := cmd.Flags().GetString("out")
			shareURL, _ := cmd.Flags().GetString("share-url")
			return runPackProvenanceCmd(apiURL, credPath, packID, packCID, depth, out, shareURL)
		},
	}
	cmd.Flags().String("pack-id", "", "Pack UUID")
	cmd.Flags().String("pack-cid", "", "Pack CID")
	cmd.Flags().Int("depth", 2, "Follow pack supersession ancestry to this depth")
	cmd.Flags().String("out", "", "Write JSON to file instead of stdout")
	cmd.Flags().String("share-url", "", fmt.Sprintf("Print a shareable viewer URL (e.g. %s)", "https://themolt.net/labs/provenance"))
	return cmd
}
