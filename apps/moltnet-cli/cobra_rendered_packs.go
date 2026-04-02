package main

import "github.com/spf13/cobra"

func newRenderedPacksCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "rendered-packs",
		Short: "Manage rendered context packs",
	}
	cmd.AddCommand(newRenderedPacksGetCmd())
	cmd.AddCommand(newRenderedPacksVerifyCmd())
	cmd.AddCommand(newRenderedPacksJudgeCmd())
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
