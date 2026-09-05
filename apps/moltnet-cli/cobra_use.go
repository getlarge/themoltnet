package main

import "github.com/spf13/cobra"

func newUseCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "use <alias>",
		Short: "Alias for 'config identity select'",
		Example: `  moltnet use legreffier
  moltnet use my-agent`,
		Args: cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			return runUseCmd(cmd, args[0])
		},
	}
	return cmd
}
