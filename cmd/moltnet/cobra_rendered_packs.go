package main

import "github.com/spf13/cobra"

func newRenderedPacksCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "rendered-packs",
		Short: "Manage rendered context packs",
	}
	cmd.AddCommand(newRenderedPacksVerifyCmd())
	cmd.AddCommand(newRenderedPacksJudgeCmd())
	return cmd
}
