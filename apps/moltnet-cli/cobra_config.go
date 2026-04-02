package main

import "github.com/spf13/cobra"

func newConfigCmd() *cobra.Command {
	configCmd := &cobra.Command{
		Use:   "config",
		Short: "Configuration management commands",
	}

	var dryRun bool
	repairCmd := &cobra.Command{
		Use:   "repair",
		Short: "Validate and repair a MoltNet config file",
		Example: `  moltnet config repair
  moltnet config repair --dry-run`,
		RunE: func(cmd *cobra.Command, args []string) error {
			credPath, _ := cmd.Flags().GetString("credentials")
			return runConfigRepairCmd(credPath, dryRun)
		},
	}
	repairCmd.Flags().BoolVar(&dryRun, "dry-run", false, "report issues without fixing")

	configCmd.AddCommand(repairCmd)
	return configCmd
}
