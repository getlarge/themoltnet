package main

import "github.com/spf13/cobra"

func newEnvCmd() *cobra.Command {
	envCmd := &cobra.Command{
		Use:   "env",
		Short: "Agent environment management",
	}

	checkCmd := &cobra.Command{
		Use:   "check",
		Short: "Validate agent env file against required variables",
		Example: `  moltnet env check
  moltnet env check --agent legreffier`,
		Args: cobra.NoArgs,
		RunE: func(cmd *cobra.Command, args []string) error {
			dir, _ := cmd.Flags().GetString("dir")
			agent, _ := cmd.Flags().GetString("agent")
			return runEnvCheckCmd(cmd, dir, agent)
		},
	}
	checkCmd.Flags().String("agent", "", "Agent name (overrides default)")
	checkCmd.Flags().String("dir", ".", "Repository root directory")

	envCmd.AddCommand(checkCmd)
	return envCmd
}
