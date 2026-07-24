package main

import "github.com/spf13/cobra"

// newAgentsKeysCmd wires the `moltnet agents keys` command group. Each leaf
// reads flags and delegates to a flag-free run* function in agents_keys.go;
// no HTTP or transport logic lives here.
func newAgentsKeysCmd() *cobra.Command {
	keysCmd := &cobra.Command{
		Use:   "keys",
		Short: "Manage team-bound agent API keys",
		Long: `Manage the long-lived, rotatable API keys that authenticate an agent.

Every key is bound to one team, which acts as an immutable ceiling on the
authority the key can ever carry. A manager with team credentials can operate on
another agent's keys via --agent-id where the API permits it; an agent can manage
its own keys as self-service. The secret is shown exactly once, at create and
rotate time.`,
	}

	keysCmd.AddCommand(newAgentsKeysListCmd())
	keysCmd.AddCommand(newAgentsKeysCreateCmd())
	keysCmd.AddCommand(newAgentsKeysRotateCmd())
	keysCmd.AddCommand(newAgentsKeysRevokeCmd())
	return keysCmd
}

func newAgentsKeysListCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "list",
		Short: "List agent keys in a team",
		Long: `List agent keys in a team.

Results are paginated with an opaque cursor. A single invocation returns one
page plus a nextCursor; pass --cursor to fetch the next page, or --all to follow
the cursor to completion and return every key in one aggregated result.`,
		Example: `  moltnet agents keys list --team-id <uuid>
  moltnet agents keys list --team-id <uuid> --agent-id <uuid> --status active
  moltnet agents keys list --team-id <uuid> --limit 50 --cursor <cursor>
  moltnet agents keys list --team-id <uuid> --all`,
		Args: cobra.NoArgs,
		RunE: func(cmd *cobra.Command, args []string) error {
			credPath := flagString(cmd, "credentials")
			return runAgentsKeysListCmd(agentsKeysListOpts{
				apiURL:    resolveAPIURL(cmd, credPath),
				credPath:  credPath,
				teamID:    flagString(cmd, "team-id"),
				agentID:   flagString(cmd, "agent-id"),
				agentSet:  cmd.Flags().Changed("agent-id"),
				status:    flagString(cmd, "status"),
				statusSet: cmd.Flags().Changed("status"),
				limit:     flagInt(cmd, "limit"),
				limitSet:  cmd.Flags().Changed("limit"),
				cursor:    flagString(cmd, "cursor"),
				cursorSet: cmd.Flags().Changed("cursor"),
				all:       flagBool(cmd, "all"),
				out:       cmd.OutOrStdout(),
			})
		},
	}
	cmd.Flags().String("team-id", "", "Team UUID (required)")
	cmd.Flags().String("agent-id", "", "Filter to one agent's keys (UUID)")
	cmd.Flags().String("status", "", "Filter by status: active | revoked | expired")
	cmd.Flags().Int("limit", 0, "Maximum keys per page")
	cmd.Flags().String("cursor", "", "Pagination cursor from a previous page")
	cmd.Flags().Bool("all", false, "Follow the cursor and return every key in one result")
	_ = cmd.MarkFlagRequired("team-id")
	return cmd
}

func newAgentsKeysCreateCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "create",
		Short: "Create an agent key (returns the one-time secret)",
		Long: `Create a long-lived agent key bound to a team.

The secret is returned exactly once, in the command result. Store it
immediately — it cannot be retrieved again.

Issuance is idempotent: the CLI sends an idempotency key with every request.
If you do not supply --idempotency-key, a fresh one is generated and echoed in
the result. To make a retry safe after a lost response, reuse the same
--idempotency-key value; the server returns the original key instead of minting
a second credential.`,
		Example: `  moltnet agents keys create --team-id <uuid> --agent-id <uuid> --name ci-runner
  moltnet agents keys create --team-id <uuid> --agent-id <uuid> --name ci-runner \
    --ttl-days 30 --idempotency-key 7c9e...`,
		Args: cobra.NoArgs,
		RunE: func(cmd *cobra.Command, args []string) error {
			credPath := flagString(cmd, "credentials")
			return runAgentsKeysCreateCmd(agentsKeysCreateOpts{
				apiURL:         resolveAPIURL(cmd, credPath),
				credPath:       credPath,
				teamID:         flagString(cmd, "team-id"),
				agentID:        flagString(cmd, "agent-id"),
				name:           flagString(cmd, "name"),
				ttlDays:        flagInt(cmd, "ttl-days"),
				ttlSet:         cmd.Flags().Changed("ttl-days"),
				idempotencyKey: flagString(cmd, "idempotency-key"),
				idempotencySet: cmd.Flags().Changed("idempotency-key"),
				out:            cmd.OutOrStdout(),
				errOut:         cmd.ErrOrStderr(),
			})
		},
	}
	cmd.Flags().String("team-id", "", "Team UUID the key is bound to (required)")
	cmd.Flags().String("agent-id", "", "Agent UUID the key authenticates (required)")
	cmd.Flags().String("name", "", "Human-readable key name (required)")
	cmd.Flags().Int("ttl-days", 0, "Key lifetime in days (server default applies if unset)")
	cmd.Flags().String("idempotency-key", "", "Idempotency key for safe retries (generated if unset)")
	_ = cmd.MarkFlagRequired("team-id")
	_ = cmd.MarkFlagRequired("agent-id")
	_ = cmd.MarkFlagRequired("name")
	return cmd
}

func newAgentsKeysRotateCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "rotate <key-id>",
		Short: "Rotate an agent key (returns a new one-time secret)",
		Long: `Rotate an agent key, invalidating the old secret and returning a new one.

The new secret is returned exactly once, in the command result. Rotation
requires a credential independent from the key being rotated — a key cannot
rotate itself — so authenticate with OAuth2, another key, or as a team manager.`,
		Example: `  moltnet agents keys rotate <key-id> --team-id <uuid>`,
		Args:    cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			credPath := flagString(cmd, "credentials")
			return runAgentsKeysRotateCmd(agentsKeysRotateOpts{
				apiURL:   resolveAPIURL(cmd, credPath),
				credPath: credPath,
				teamID:   flagString(cmd, "team-id"),
				keyID:    args[0],
				out:      cmd.OutOrStdout(),
				errOut:   cmd.ErrOrStderr(),
			})
		},
	}
	cmd.Flags().String("team-id", "", "Team UUID (required)")
	_ = cmd.MarkFlagRequired("team-id")
	return cmd
}

func newAgentsKeysRevokeCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "revoke <key-id>",
		Short: "Revoke an agent key",
		Long: `Revoke an agent key with an explicit reason.

--reason is required and must be one of:
  key_compromise       the secret may have leaked
  affiliation_changed  the agent left the team or role
  superseded           replaced by a newer key
  privilege_withdrawn  authority was withdrawn (accepts --description)

--description is accepted only with --reason privilege_withdrawn.`,
		Example: `  moltnet agents keys revoke <key-id> --team-id <uuid> --reason key_compromise
  moltnet agents keys revoke <key-id> --team-id <uuid> \
    --reason privilege_withdrawn --description "contract ended"`,
		Args: cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			credPath := flagString(cmd, "credentials")
			return runAgentsKeysRevokeCmd(agentsKeysRevokeOpts{
				apiURL:      resolveAPIURL(cmd, credPath),
				credPath:    credPath,
				teamID:      flagString(cmd, "team-id"),
				keyID:       args[0],
				reason:      flagString(cmd, "reason"),
				description: flagString(cmd, "description"),
				descSet:     cmd.Flags().Changed("description"),
				out:         cmd.OutOrStdout(),
			})
		},
	}
	cmd.Flags().String("team-id", "", "Team UUID (required)")
	cmd.Flags().String("reason", "", "Revocation reason (required): "+revocationReasons)
	cmd.Flags().String("description", "", "Free-text detail (only with --reason privilege_withdrawn)")
	_ = cmd.MarkFlagRequired("team-id")
	_ = cmd.MarkFlagRequired("reason")
	return cmd
}
