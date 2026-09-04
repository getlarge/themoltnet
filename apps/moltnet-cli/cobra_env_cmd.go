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
  moltnet env check --identity legreffier`,
		Args: cobra.NoArgs,
		RunE: func(cmd *cobra.Command, args []string) error {
			identity, _ := cmd.Flags().GetString("identity")
			return runEnvCheckCmd(cmd, identity)
		},
	}
	checkCmd.Flags().String("identity", "", "Central identity alias (overrides active/default identity)")

	var configureIdentity string
	var teamID, diaryID, authorship, humanIdentity string
	var clearTeamID, clearDiaryID, clearHumanIdentity bool
	configureCmd := &cobra.Command{
		Use:   "configure",
		Short: "Safely update non-secret agent environment settings",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, args []string) error {
			return runEnvConfigureCmd(cmd, envConfigureOptions{
				Identity: configureIdentity,
				TeamID:   teamID, DiaryID: diaryID, Authorship: authorship,
				HumanGitIdentity: humanIdentity,
				ClearTeamID:      clearTeamID, ClearDiaryID: clearDiaryID,
				ClearHumanGitIdentity: clearHumanIdentity,
			}, cmd.Flags().Changed)
		},
	}
	configureCmd.Flags().StringVar(&configureIdentity, "identity", "", "Central identity alias (overrides active/default identity)")
	configureCmd.Flags().StringVar(&teamID, "team-id", "", "Team UUID")
	configureCmd.Flags().BoolVar(&clearTeamID, "clear-team-id", false, "Remove the configured team")
	configureCmd.Flags().StringVar(&diaryID, "diary-id", "", "Diary UUID")
	configureCmd.Flags().BoolVar(&clearDiaryID, "clear-diary-id", false, "Remove the configured diary")
	configureCmd.Flags().StringVar(&authorship, "authorship", "", "Commit authorship mode: agent, human, or coauthor")
	configureCmd.Flags().StringVar(&humanIdentity, "human-git-identity", "", "Human Git identity in Name <email> form")
	configureCmd.Flags().BoolVar(&clearHumanIdentity, "clear-human-git-identity", false, "Remove the human Git identity")

	envCmd.AddCommand(checkCmd, configureCmd)
	return envCmd
}
