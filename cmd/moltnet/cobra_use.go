package main

import "github.com/spf13/cobra"

func newUseCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "use <agent-name>",
		Short: "Set the default agent for this repository",
		Example: `  moltnet use legreffier
  moltnet use my-agent`,
		Args: cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			dir, _ := cmd.Flags().GetString("dir")
			return runUseCmd(cmd, dir, args[0])
		},
	}
	cmd.Flags().String("dir", ".", "Repository root directory")
	return cmd
}
