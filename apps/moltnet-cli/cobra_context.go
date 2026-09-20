package main

import "github.com/spf13/cobra"

func newContextCmd() *cobra.Command {
	root := &cobra.Command{Use: "context", Short: "Manage the team and diary bound to the current location"}
	var show contextCommandOptions
	showCmd := &cobra.Command{
		Use: "show", Short: "Show the team and diary that apply here, and where they come from", Args: cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error { return runContextShowCmd(cmd, show) },
	}
	addNativeProjectFlags(showCmd)
	showCmd.Flags().StringVar(&show.Identity, "identity", "", "Central identity alias")
	showCmd.Flags().BoolVar(&show.JSON, "json", false, "Print JSON")

	var set contextCommandOptions
	setCmd := &cobra.Command{
		Use: "set", Short: "Bind the current repository (or directory, outside Git) to a team and diary", Args: cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error { return runContextSetCmd(cmd, set) },
	}
	setCmd.Flags().StringVar(&set.Identity, "identity", "", "Central identity alias")
	setCmd.Flags().StringVar(&set.TeamID, "team-id", "", "Team UUID")
	setCmd.Flags().StringVar(&set.DiaryID, "diary-id", "", "Diary UUID")

	var clear contextCommandOptions
	clearCmd := &cobra.Command{
		Use: "clear", Short: "Remove the binding for the current location", Args: cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error { return runContextClearCmd(cmd, clear) },
	}
	clearCmd.Flags().StringVar(&clear.Identity, "identity", "", "Central identity alias")

	var resetIdentity string
	resetCmd := &cobra.Command{Use: "reset", Short: "Remove all legacy context registrations for an identity", Args: cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error { return runContextResetCmd(cmd, resetIdentity) },
	}
	resetCmd.Flags().StringVar(&resetIdentity, "identity", "", "Central identity alias")
	setCmd.Deprecated = "use projects bindings set with an explicit checkout path"
	root.AddCommand(showCmd, setCmd, clearCmd, resetCmd)
	return root
}
