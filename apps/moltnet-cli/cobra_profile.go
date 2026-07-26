package main

import (
	"github.com/spf13/cobra"
)

func newProfileCmd() *cobra.Command {
	profileCmd := &cobra.Command{
		Use:   "profile",
		Short: "Manage runtime profiles (provider, model, sandbox policy)",
		Long: `Runtime profiles carry the provider, model, sandbox policy, prerequisites,
and timing defaults a daemon uses to run tasks. The value passed to
MOLTNET_AGENT_PROFILE is a profile id (or name).

list and get require team membership; create, update, and delete require the
team's manage-runtime role. Team context comes from --team-id, falling back to
the token's current team when the flag is omitted.`,
	}
	profileCmd.AddCommand(newProfileListCmd())
	profileCmd.AddCommand(newProfileGetCmd())
	profileCmd.AddCommand(newProfileCreateCmd())
	profileCmd.AddCommand(newProfileUpdateCmd())
	profileCmd.AddCommand(newProfileDeleteCmd())
	return profileCmd
}

func newProfileListCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:     "list",
		Short:   "List runtime profiles for a team",
		Example: `  moltnet profile list --team-id 6743b4b1-6b93-46e2-a048-19490f04f91a`,
		RunE: func(cmd *cobra.Command, args []string) error {
			credPath, _ := cmd.Flags().GetString("credentials")
			apiURL := resolveAPIURL(cmd, credPath)
			teamID, _ := cmd.Flags().GetString("team-id")
			return runProfileListCmd(apiURL, credPath, teamID)
		},
	}
	cmd.Flags().String("team-id", "", "Team UUID to scope the listing (defaults to the token's current team)")
	return cmd
}

func newProfileGetCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "get <profile-id|name>",
		Short: "Get a runtime profile by id or name",
		Example: `  moltnet profile get 1a653eb9-7bfa-475f-b517-c070c9c25b5e
  moltnet profile get "Standard engineering" --team-id 6743b4b1-6b93-46e2-a048-19490f04f91a`,
		Args: cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			credPath, _ := cmd.Flags().GetString("credentials")
			apiURL := resolveAPIURL(cmd, credPath)
			teamID, _ := cmd.Flags().GetString("team-id")
			return runProfileGetCmd(apiURL, credPath, args[0], teamID)
		},
	}
	cmd.Flags().String("team-id", "", "Team UUID used to resolve a profile name to an id")
	return cmd
}

func newProfileCreateCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "create --from-file <path>",
		Short: "Create a runtime profile from a JSON definition file",
		Long: `Create a runtime profile from a JSON file matching CreateRuntimeProfileBody
(name, provider, model, and a sandbox object are required; every other field is
optional). Use "-" to read the definition from stdin.

A JSON file is preferred over a wide flag surface because the sandbox policy —
network allowlists, VFS shadow rules, resource limits — is a security artifact
worth reviewing, diffing, and committing next to the workflow that consumes the
profile.`,
		Example: `  moltnet profile create --from-file profile.json --team-id 6743b4b1-6b93-46e2-a048-19490f04f91a`,
		RunE: func(cmd *cobra.Command, args []string) error {
			credPath, _ := cmd.Flags().GetString("credentials")
			apiURL := resolveAPIURL(cmd, credPath)
			fromFile, _ := cmd.Flags().GetString("from-file")
			teamID, _ := cmd.Flags().GetString("team-id")
			return runProfileCreateCmd(apiURL, credPath, fromFile, teamID)
		},
	}
	cmd.Flags().String("from-file", "", `Path to a JSON profile definition, or "-" for stdin (required)`)
	cmd.Flags().String("team-id", "", "Team UUID that will own the profile (defaults to the token's current team)")
	_ = cmd.MarkFlagRequired("from-file")
	return cmd
}

func newProfileUpdateCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "update <profile-id|name> --from-file <path>",
		Short: "Update a runtime profile from a partial JSON patch file",
		Long: `Apply a partial update from a JSON file matching UpdateRuntimeProfileBody
(any subset of the profile fields, at least one). Use "-" to read from stdin.
Updating bumps the profile's revision and recomputes its definition CID.`,
		Example: `  moltnet profile update 1a653eb9-7bfa-475f-b517-c070c9c25b5e --from-file patch.json`,
		Args:    cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			credPath, _ := cmd.Flags().GetString("credentials")
			apiURL := resolveAPIURL(cmd, credPath)
			fromFile, _ := cmd.Flags().GetString("from-file")
			teamID, _ := cmd.Flags().GetString("team-id")
			return runProfileUpdateCmd(apiURL, credPath, args[0], fromFile, teamID)
		},
	}
	cmd.Flags().String("from-file", "", `Path to a JSON patch, or "-" for stdin (required)`)
	cmd.Flags().String("team-id", "", "Team UUID used to resolve a profile name to an id")
	_ = cmd.MarkFlagRequired("from-file")
	return cmd
}

func newProfileDeleteCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:     "delete <profile-id|name>",
		Short:   "Delete a runtime profile by id or name",
		Example: `  moltnet profile delete 1a653eb9-7bfa-475f-b517-c070c9c25b5e`,
		Args:    cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			credPath, _ := cmd.Flags().GetString("credentials")
			apiURL := resolveAPIURL(cmd, credPath)
			teamID, _ := cmd.Flags().GetString("team-id")
			return runProfileDeleteCmd(apiURL, credPath, args[0], teamID)
		},
	}
	cmd.Flags().String("team-id", "", "Team UUID used to resolve a profile name to an id")
	return cmd
}
