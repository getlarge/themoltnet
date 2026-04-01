package main

import "github.com/spf13/cobra"

func newGitCmd() *cobra.Command {
	gitCmd := &cobra.Command{
		Use:   "git",
		Short: "Git identity commands",
	}

	var name, email string
	setupCmd := &cobra.Command{
		Use:   "setup",
		Short: "Configure git identity for SSH commit signing",
		Example: `  moltnet git setup
  moltnet git setup --name "my-agent" --email "agent@example.com"`,
		RunE: func(cmd *cobra.Command, args []string) error {
			credPath, _ := cmd.Flags().GetString("credentials")
			return runGitSetupCmd(credPath, name, email)
		},
	}
	setupCmd.Flags().StringVar(&name, "name", "", "git committer name")
	setupCmd.Flags().StringVar(&email, "email", "", "git committer email")

	gitCmd.AddCommand(setupCmd)
	return gitCmd
}
