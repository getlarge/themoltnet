package main

import "github.com/spf13/cobra"

func newContextCmd() *cobra.Command {
	root := &cobra.Command{Use: "context", Short: "Manage repository and directory activation contexts"}
	var show contextCommandOptions
	showCmd := &cobra.Command{
		Use: "show", Short: "Show the resolved activation context", Args: cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error { return runContextShowCmd(cmd, show) },
	}
	showCmd.Flags().StringVar(&show.Identity, "identity", "", "Central identity alias")
	showCmd.Flags().StringVar(&show.Directory, "directory", "", "Resolve context for this directory")
	showCmd.Flags().BoolVar(&show.JSON, "json", false, "Print JSON")

	var set contextCommandOptions
	setCmd := &cobra.Command{
		Use: "set", Short: "Bind the current repository or directory to a team and diary", Args: cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error { return runContextSetCmd(cmd, set) },
	}
	setCmd.Flags().StringVar(&set.Identity, "identity", "", "Central identity alias")
	setCmd.Flags().StringVar(&set.TeamID, "team-id", "", "Team UUID")
	setCmd.Flags().StringVar(&set.DiaryID, "diary-id", "", "Diary UUID")
	setCmd.Flags().BoolVar(&set.Default, "default", false, "Set the identity-wide fallback binding")
	setCmd.Flags().StringVar(&set.Directory, "directory", "", "Set an explicit directory override")

	var clear contextCommandOptions
	clearCmd := &cobra.Command{
		Use: "clear", Short: "Clear the current repository, directory, or default binding", Args: cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error { return runContextClearCmd(cmd, clear) },
	}
	clearCmd.Flags().StringVar(&clear.Identity, "identity", "", "Central identity alias")
	clearCmd.Flags().BoolVar(&clear.Default, "default", false, "Clear the identity-wide fallback binding")
	clearCmd.Flags().StringVar(&clear.Directory, "directory", "", "Clear an explicit directory override")

	root.AddCommand(showCmd, setCmd, clearCmd)
	return root
}
