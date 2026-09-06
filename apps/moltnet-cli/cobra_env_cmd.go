package main

import (
	"fmt"

	"github.com/spf13/cobra"
)

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
			if identity == "" {
				identity, _ = cmd.Flags().GetString("agent")
			}
			return runEnvCheckCmd(cmd, identity)
		},
	}
	checkCmd.Flags().String("identity", "", "Central identity alias (overrides active/default identity)")
	addDeprecatedIdentityFlags(checkCmd)

	var configureIdentity string
	var teamID, diaryID, authorship, humanIdentity string
	var clearTeamID, clearDiaryID, clearHumanIdentity bool
	configureCmd := &cobra.Command{
		Use:   "configure",
		Short: "Safely update non-secret agent environment settings",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, args []string) error {
			identity := configureIdentity
			if identity == "" {
				identity, _ = cmd.Flags().GetString("agent")
			}
			return runEnvConfigureCmd(cmd, envConfigureOptions{
				Identity: identity,
				TeamID:   teamID, DiaryID: diaryID, Authorship: authorship,
				HumanGitIdentity: humanIdentity,
				ClearTeamID:      clearTeamID, ClearDiaryID: clearDiaryID,
				ClearHumanGitIdentity: clearHumanIdentity,
			}, cmd.Flags().Changed)
		},
	}
	configureCmd.Flags().StringVar(&configureIdentity, "identity", "", "Central identity alias (overrides active/default identity)")
	addDeprecatedIdentityFlags(configureCmd)
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

// addDeprecatedIdentityFlags keeps existing automation working for one release
// while identity selection moves from repository agent names to central aliases.
func addDeprecatedIdentityFlags(cmd *cobra.Command) {
	cmd.Flags().String("agent", "", "Deprecated identity alias")
	cmd.Flags().String("dir", "", "Deprecated repository directory")
	_ = cmd.Flags().MarkDeprecated("agent", "use --identity")
	_ = cmd.Flags().MarkDeprecated("dir", "repository identity discovery was removed")
	_ = cmd.Flags().MarkHidden("agent")
	_ = cmd.Flags().MarkHidden("dir")

	// --agent still maps onto --identity, but --dir has no meaning in a central
	// store and nothing reads it. Accepting it silently redirected automation
	// that named a repository identity to the machine-global one instead —
	// exactly the failure an ignored argument always produces. Reject it and
	// say what to do.
	previous := cmd.PreRunE
	cmd.PreRunE = func(c *cobra.Command, args []string) error {
		if c.Flags().Changed("dir") {
			return fmt.Errorf(
				"--dir is no longer supported: identities live in the central store, "+
					"not in a repository.\n"+
					"Select one with 'moltnet config identity select <alias>', pass "+
					"--identity <alias>, or migrate a repository bundle with "+
					"'moltnet config migrate --credentials %s/.moltnet/<alias>/moltnet.json'.",
				c.Flags().Lookup("dir").Value.String(),
			)
		}
		if previous != nil {
			return previous(c, args)
		}
		return nil
	}
}
