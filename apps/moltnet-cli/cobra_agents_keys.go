package main

import "github.com/spf13/cobra"

// newAgentsKeysCmd wires the `moltnet agents keys` command group. Each leaf
// reads flags and delegates to a flag-free run* function in agents_keys.go;
// no HTTP or transport logic lives here.
func newAgentsKeysCmd() *cobra.Command {
	keysCmd := &cobra.Command{
		Use:   "keys",
		Short: "Manage team- or identity-scoped agent API keys",
		Long: `Manage the long-lived, rotatable API keys that authenticate an agent.

Team-bound keys remain the default mode and use --team-id. Identity-scoped keys
use --identity-scoped and can authenticate the same agent across authorized
teams. Identity lifecycle operations are agent self-service; team credentials
and human or manager sessions cannot manage them. The secret is shown exactly
once, at create and rotate time.`,
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
		Short: "List team- or identity-scoped agent keys",
		Long: `List agent keys for exactly one binding mode.

Results are paginated with an opaque cursor. A single invocation returns one
page plus a nextCursor; pass --cursor to fetch the next page, or --all to follow
the cursor to completion and return every key in one aggregated result.`,
		Example: `  moltnet agents keys list --team-id <uuid>
	  moltnet agents keys list --identity-scoped
  moltnet agents keys list --team-id <uuid> --agent-id <uuid> --status active
  moltnet agents keys list --team-id <uuid> --limit 50 --cursor <cursor>
  moltnet agents keys list --team-id <uuid> --all`,
		Args:    cobra.NoArgs,
		PreRunE: validateAgentKeyBindingFlags,
		RunE: func(cmd *cobra.Command, args []string) error {
			credPath := flagString(cmd, "credentials")
			return runAgentsKeysListCmd(agentsKeysListOpts{
				apiURL:         resolveAPIURL(cmd, credPath),
				credPath:       credPath,
				teamID:         flagString(cmd, "team-id"),
				identityScoped: flagBool(cmd, "identity-scoped"),
				agentID:        flagString(cmd, "agent-id"),
				agentSet:       cmd.Flags().Changed("agent-id"),
				status:         flagString(cmd, "status"),
				statusSet:      cmd.Flags().Changed("status"),
				limit:          flagInt(cmd, "limit"),
				limitSet:       cmd.Flags().Changed("limit"),
				cursor:         flagString(cmd, "cursor"),
				cursorSet:      cmd.Flags().Changed("cursor"),
				all:            flagBool(cmd, "all"),
				out:            cmd.OutOrStdout(),
			})
		},
	}
	cmd.Flags().String("team-id", "", "Team UUID (mutually exclusive with --identity-scoped)")
	cmd.Flags().Bool("identity-scoped", false, "Manage keys bound to the agent identity")
	cmd.Flags().String("agent-id", "", "Filter to one agent's keys (UUID)")
	cmd.Flags().String("status", "", "Filter by status: active | revoked | expired")
	cmd.Flags().Int("limit", 0, "Maximum keys per page")
	cmd.Flags().String("cursor", "", "Pagination cursor from a previous page")
	cmd.Flags().Bool("all", false, "Follow the cursor and return every key in one result")
	return cmd
}

func newAgentsKeysCreateCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "create",
		Short: "Create an agent key (returns the one-time secret)",
		Long: `Create a long-lived agent key in exactly one binding mode.

Pass --team-id for the existing team-bound behavior, or --identity-scoped for a
portable agent-identity binding. Identity-scoped issuance is agent self-service.

The secret is returned exactly once, in the command result. Store it
immediately — it cannot be retrieved again.

Issuance is idempotent: the CLI sends an idempotency key with every request.
If you do not supply --idempotency-key, a fresh one is generated and echoed in
the result. To make a retry safe after a lost response, reuse the same
--idempotency-key value; the server returns the original key instead of minting
a second credential.`,
		Example: `  moltnet agents keys create --team-id <uuid> --agent-id <uuid> --name ci-runner
	  moltnet agents keys create --identity-scoped --agent-id <uuid> --name portable-runner
  moltnet agents keys create --team-id <uuid> --agent-id <uuid> --name ci-runner \
    --ttl-days 30 --idempotency-key 7c9e...
  moltnet agents keys create --team-id <uuid> --agent-id <uuid> --name daemon --store`,
		Args:    cobra.NoArgs,
		PreRunE: validateAgentKeyBindingFlags,
		RunE: func(cmd *cobra.Command, args []string) error {
			credPath := flagString(cmd, "credentials")
			return runAgentsKeysCreateCmd(agentsKeysCreateOpts{
				apiURL:         resolveAPIURL(cmd, credPath),
				credPath:       credPath,
				teamID:         flagString(cmd, "team-id"),
				identityScoped: flagBool(cmd, "identity-scoped"),
				agentID:        flagString(cmd, "agent-id"),
				name:           flagString(cmd, "name"),
				ttlDays:        flagInt(cmd, "ttl-days"),
				ttlSet:         cmd.Flags().Changed("ttl-days"),
				idempotencyKey: flagString(cmd, "idempotency-key"),
				idempotencySet: cmd.Flags().Changed("idempotency-key"),
				store:          agentKeyStoreFlags(cmd),
				out:            cmd.OutOrStdout(),
				errOut:         cmd.ErrOrStderr(),
			})
		},
	}
	cmd.Flags().String("team-id", "", "Team UUID the key is bound to")
	cmd.Flags().Bool("identity-scoped", false, "Bind the key to the agent identity")
	cmd.Flags().String("agent-id", "", "Agent UUID the key authenticates (required)")
	cmd.Flags().String("name", "", "Human-readable key name (required)")
	cmd.Flags().Int("ttl-days", 0, "Key lifetime in days (server default applies if unset)")
	cmd.Flags().String("idempotency-key", "", "Idempotency key for safe retries (generated if unset)")
	addAgentKeyStoreFlags(cmd)
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
		Example: `  moltnet agents keys rotate <key-id> --team-id <uuid>
  moltnet agents keys rotate <key-id> --team-id <uuid> --store`,
		Args:    cobra.ExactArgs(1),
		PreRunE: validateAgentKeyBindingFlags,
		RunE: func(cmd *cobra.Command, args []string) error {
			credPath := flagString(cmd, "credentials")
			return runAgentsKeysRotateCmd(agentsKeysRotateOpts{
				apiURL:         resolveAPIURL(cmd, credPath),
				credPath:       credPath,
				teamID:         flagString(cmd, "team-id"),
				identityScoped: flagBool(cmd, "identity-scoped"),
				keyID:          args[0],
				store:          agentKeyStoreFlags(cmd),
				out:            cmd.OutOrStdout(),
				errOut:         cmd.ErrOrStderr(),
			})
		},
	}
	cmd.Flags().String("team-id", "", "Team UUID (mutually exclusive with --identity-scoped)")
	cmd.Flags().Bool("identity-scoped", false, "Rotate an identity-scoped key")
	addAgentKeyStoreFlags(cmd)
	return cmd
}

// addAgentKeyStoreFlags wires --store/--destination: the secret goes to a
// provider and moltnet.json gains agent_key_ref instead of the secret being
// printed.
func addAgentKeyStoreFlags(cmd *cobra.Command) {
	cmd.Flags().Bool("store", false, "Store the secret in a provider under agent-key/<identity_id> and set agent_key_ref in the credentials file instead of printing it")
	cmd.Flags().String("destination", defaultMigrationDestination, "Secret provider used by --store (os-keyring, or file with MOLTNET_SECRET_ROOT_WRITABLE=1)")
}

func agentKeyStoreFlags(cmd *cobra.Command) agentKeyStoreOpts {
	return agentKeyStoreOpts{
		enabled:     flagBool(cmd, "store"),
		destination: flagString(cmd, "destination"),
	}
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
		Args:    cobra.ExactArgs(1),
		PreRunE: validateAgentKeyBindingFlags,
		RunE: func(cmd *cobra.Command, args []string) error {
			credPath := flagString(cmd, "credentials")
			return runAgentsKeysRevokeCmd(agentsKeysRevokeOpts{
				apiURL:         resolveAPIURL(cmd, credPath),
				credPath:       credPath,
				teamID:         flagString(cmd, "team-id"),
				identityScoped: flagBool(cmd, "identity-scoped"),
				keyID:          args[0],
				reason:         flagString(cmd, "reason"),
				description:    flagString(cmd, "description"),
				descSet:        cmd.Flags().Changed("description"),
				out:            cmd.OutOrStdout(),
			})
		},
	}
	cmd.Flags().String("team-id", "", "Team UUID (mutually exclusive with --identity-scoped)")
	cmd.Flags().Bool("identity-scoped", false, "Revoke an identity-scoped key")
	cmd.Flags().String("reason", "", "Revocation reason (required): "+revocationReasonsText())
	cmd.Flags().String("description", "", "Free-text detail (only with --reason privilege_withdrawn)")
	_ = cmd.MarkFlagRequired("reason")
	return cmd
}

func validateAgentKeyBindingFlags(cmd *cobra.Command, _ []string) error {
	return validateAgentKeyBinding(
		flagString(cmd, "team-id"),
		flagBool(cmd, "identity-scoped"),
	)
}
