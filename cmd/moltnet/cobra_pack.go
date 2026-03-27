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
	packCmd.AddCommand(newPackProvenanceCmd())

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
