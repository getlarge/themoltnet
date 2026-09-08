package main

import (
	"github.com/spf13/cobra"
)

const policyTeamFlagUsage = "Team UUID that owns the policy (required: runtime policies are team-scoped)"

func newPolicyCmd() *cobra.Command {
	policyCmd := &cobra.Command{
		Use:   "policy",
		Short: "Manage runtime policies (tool and shell-command allow-lists)",
		Long: `Runtime policies are named allow-lists of tools and shell-command prefixes.
A runtime profile binds a set of policies and chooses an enforcement mode; the
union of the bound policies is what a session enforces.

The end-to-end workflow is:

  1. moltnet policy create --from-file policy.json --team-id <uuid>
  2. moltnet profile set-policies <profile> --policy <name> --team-id <uuid>
  3. moltnet profile update <profile> --from-file enforcement.json
  4. moltnet profile allowed-tools <profile> --team-id <uuid>

Step 3 sets toolEnforcement to off, watch, or enforce. "watch" logs what a
session would have been denied without blocking it, which is the safe way to
learn a real allow-set before switching to "enforce". Step 4 resolves what will
actually be enforced, because bindings and mode are set independently.

Unlike runtime profiles, every policy endpoint requires the team header, so
--team-id is mandatory rather than falling back to the token's current team.`,
	}
	policyCmd.AddCommand(newPolicyListCmd())
	policyCmd.AddCommand(newPolicyGetCmd())
	policyCmd.AddCommand(newPolicyCreateCmd())
	policyCmd.AddCommand(newPolicyUpdateCmd())
	policyCmd.AddCommand(newPolicyDeleteCmd())
	return policyCmd
}

func newPolicyListCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:     "list",
		Short:   "List runtime policies for a team",
		Example: `  moltnet policy list --team-id 6743b4b1-6b93-46e2-a048-19490f04f91a`,
		Args:    cobra.NoArgs,
		RunE: func(cmd *cobra.Command, args []string) error {
			credPath, _ := cmd.Flags().GetString("credentials")
			apiURL := resolveAPIURL(cmd, credPath)
			teamID, _ := cmd.Flags().GetString("team-id")
			return runPolicyListCmd(cmd.OutOrStdout(), apiURL, credPath, teamID)
		},
	}
	cmd.Flags().String("team-id", "", policyTeamFlagUsage)
	return cmd
}

func newPolicyGetCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "get <policy-id|name>",
		Short: "Get a runtime policy, with its tools and shell-command rules",
		Example: `  moltnet policy get read-only-review --team-id 6743b4b1-6b93-46e2-a048-19490f04f91a
  moltnet policy get 9c11f859-0fb8-4ade-97c5-9c1662e30d8b --team-id 6743b4b1-6b93-46e2-a048-19490f04f91a`,
		Args: cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			credPath, _ := cmd.Flags().GetString("credentials")
			apiURL := resolveAPIURL(cmd, credPath)
			teamID, _ := cmd.Flags().GetString("team-id")
			return runPolicyGetCmd(cmd.OutOrStdout(), apiURL, credPath, args[0], teamID)
		},
	}
	cmd.Flags().String("team-id", "", policyTeamFlagUsage)
	return cmd
}

func newPolicyCreateCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "create --from-file <path>",
		Short: "Create a runtime policy from a JSON definition file",
		Long: `Create a runtime policy from a JSON file matching the runtime-policy create
schema in the API reference (POST /runtime-policies). Use "-" to read from
stdin.

  {
    "name": "read-only-review",
    "description": "Inspection access for PR review tasks.",
    "tools": ["read", "grep", "glob"],
    "shellCommands": [
      { "argvPrefix": ["git", "diff"] },
      { "argvPrefix": ["git", "log"] }
    ]
  }

"tools" names runtime tools. Each shellCommands entry is an argv prefix matched
from the executable onward; extra argv tokens stay permitted, so
["git", "diff"] also allows "git diff --stat HEAD~1".

A JSON file is preferred over a wide flag surface for the same reason it is for
sandbox policies: the allow-list is a security artifact worth reviewing,
diffing, and committing next to the workflow that consumes it.`,
		Example: `  moltnet policy create --from-file policy.json --team-id 6743b4b1-6b93-46e2-a048-19490f04f91a`,
		Args:    cobra.NoArgs,
		RunE: func(cmd *cobra.Command, args []string) error {
			credPath, _ := cmd.Flags().GetString("credentials")
			apiURL := resolveAPIURL(cmd, credPath)
			fromFile, _ := cmd.Flags().GetString("from-file")
			teamID, _ := cmd.Flags().GetString("team-id")
			return runPolicyCreateCmd(cmd.OutOrStdout(), apiURL, credPath, fromFile, teamID)
		},
	}
	cmd.Flags().String("from-file", "", `Path to a JSON policy definition, or "-" for stdin (required)`)
	cmd.Flags().String("team-id", "", policyTeamFlagUsage)
	_ = cmd.MarkFlagRequired("from-file")
	return cmd
}

func newPolicyUpdateCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "update <policy-id|name> --from-file <path>",
		Short: "Update a runtime policy from an add/remove JSON patch file",
		Long: `Apply a patch from a JSON file matching the runtime-policy update schema
(PATCH /runtime-policies/{id}). Use "-" to read from stdin.

The patch is additive and subtractive rather than a whole-document
replacement, so it names only the delta:

  {
    "addTools": ["glob"],
    "removeTools": ["write"],
    "addShellCommands": [{ "argvPrefix": ["git", "show"] }],
    "removeShellCommands": [{ "argvPrefix": ["git", "push"] }]
  }

"name" and "description" may also be set. Removing a tool from a policy takes
effect for sessions started afterwards; it does not retroactively change a
session already running against an older policy snapshot.`,
		Example: `  moltnet policy update read-only-review --from-file patch.json --team-id 6743b4b1-6b93-46e2-a048-19490f04f91a`,
		Args:    cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			credPath, _ := cmd.Flags().GetString("credentials")
			apiURL := resolveAPIURL(cmd, credPath)
			fromFile, _ := cmd.Flags().GetString("from-file")
			teamID, _ := cmd.Flags().GetString("team-id")
			return runPolicyUpdateCmd(cmd.OutOrStdout(), apiURL, credPath, args[0], fromFile, teamID)
		},
	}
	cmd.Flags().String("from-file", "", `Path to a JSON patch, or "-" for stdin (required)`)
	cmd.Flags().String("team-id", "", policyTeamFlagUsage)
	_ = cmd.MarkFlagRequired("from-file")
	return cmd
}

func newPolicyDeleteCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:     "delete <policy-id|name>",
		Short:   "Delete a runtime policy by id or name",
		Example: `  moltnet policy delete read-only-review --team-id 6743b4b1-6b93-46e2-a048-19490f04f91a`,
		Args:    cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			credPath, _ := cmd.Flags().GetString("credentials")
			apiURL := resolveAPIURL(cmd, credPath)
			teamID, _ := cmd.Flags().GetString("team-id")
			return runPolicyDeleteCmd(cmd.ErrOrStderr(), apiURL, credPath, args[0], teamID)
		},
	}
	cmd.Flags().String("team-id", "", policyTeamFlagUsage)
	return cmd
}

// --- Profile-side binding commands ---
//
// Binding lives under `profile` rather than `policy` because the profile owns
// the relationship: it holds the enforcement mode, and the resolved allow-set
// is a property of the profile, not of any single policy.

func newProfilePoliciesCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:     "policies <profile-id|name>",
		Short:   "List the runtime policies bound to a profile",
		Example: `  moltnet profile policies legreffier-review-v1 --team-id 6743b4b1-6b93-46e2-a048-19490f04f91a`,
		Args:    cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			credPath, _ := cmd.Flags().GetString("credentials")
			apiURL := resolveAPIURL(cmd, credPath)
			teamID, _ := cmd.Flags().GetString("team-id")
			return runProfilePoliciesCmd(cmd.OutOrStdout(), apiURL, credPath, args[0], teamID)
		},
	}
	cmd.Flags().String("team-id", "", policyTeamFlagUsage)
	return cmd
}

func newProfileSetPoliciesCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "set-policies <profile-id|name> --policy <policy-id|name>...",
		Short: "Replace the set of runtime policies bound to a profile",
		Long: `Replace the whole set of policies bound to a profile
(PUT /runtime-profiles/{id}/policies).

This replaces rather than merges: the policies passed become the complete set.
Unbinding everything therefore has to be asked for explicitly with --clear, so
a mistyped flag cannot silently strip a profile's allow-list.

Binding policies does not by itself enforce anything — the profile's
toolEnforcement mode decides that. Set it with "moltnet profile update", and
confirm the result with "moltnet profile allowed-tools".`,
		Example: `  moltnet profile set-policies legreffier-review-v1 --policy read-only-review --team-id 6743b4b1-6b93-46e2-a048-19490f04f91a
  moltnet profile set-policies legreffier-review-v1 --policy read-only-review --policy diary-write --team-id 6743b4b1-6b93-46e2-a048-19490f04f91a
  moltnet profile set-policies legreffier-review-v1 --clear --team-id 6743b4b1-6b93-46e2-a048-19490f04f91a`,
		Args: cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			credPath, _ := cmd.Flags().GetString("credentials")
			apiURL := resolveAPIURL(cmd, credPath)
			teamID, _ := cmd.Flags().GetString("team-id")
			policies, _ := cmd.Flags().GetStringArray("policy")
			clear, _ := cmd.Flags().GetBool("clear")
			return runProfileSetPoliciesCmd(cmd.OutOrStdout(), cmd.ErrOrStderr(), apiURL, credPath, args[0], policies, clear, teamID)
		},
	}
	cmd.Flags().StringArray("policy", nil, "Policy id or name to bind; repeat for several")
	cmd.Flags().Bool("clear", false, "Unbind every policy from the profile")
	cmd.Flags().String("team-id", "", policyTeamFlagUsage)
	return cmd
}

func newProfileAllowedToolsCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "allowed-tools <profile-id|name>",
		Short: "Resolve the enforcement mode and allow-set a session will apply",
		Long: `Resolve what a session on this profile will actually enforce: the mode plus
the union of every bound policy (GET /runtime-profiles/{id}/allowed-tools).

Bindings and enforcement mode are set independently, so this is the only
command that answers "what will actually happen" — a profile can have policies
bound while enforcement is off, or enforcement on with nothing bound.`,
		Example: `  moltnet profile allowed-tools legreffier-review-v1 --team-id 6743b4b1-6b93-46e2-a048-19490f04f91a`,
		Args:    cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			credPath, _ := cmd.Flags().GetString("credentials")
			apiURL := resolveAPIURL(cmd, credPath)
			teamID, _ := cmd.Flags().GetString("team-id")
			return runProfileAllowedToolsCmd(cmd.OutOrStdout(), apiURL, credPath, args[0], teamID)
		},
	}
	cmd.Flags().String("team-id", "", policyTeamFlagUsage)
	return cmd
}
