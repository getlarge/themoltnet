package main

import "github.com/spf13/cobra"

// newStartCmd creates the "moltnet start" command.
// Supported targets correspond to the agent adapters in the legreffier CLI:
//   - claude  → packages/legreffier-cli/src/adapters/claude.ts
//   - codex   → packages/legreffier-cli/src/adapters/codex.ts
//
// To add a new target, create the adapter in legreffier first, then update
// the Use line and examples below.
func newStartCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "start <target> [-- <target-args>...]",
		Short: "Start an agent session with resolved credentials",
		Long: `Start an agent session with the resolved central identity environment.
Sources ~/.config/moltnet/identities/<alias>/env and exec's into the target binary.
Common targets: claude, codex.`,
		Example: `  moltnet start claude
  moltnet start codex
  moltnet start claude --identity legreffier
  moltnet start codex -- --model gpt-5.4 --profile dev
  moltnet start claude --dry-run`,
		Args: cobra.MinimumNArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			identity, _ := cmd.Flags().GetString("identity")
			agent, _ := cmd.Flags().GetString("agent")
			if identity == "" {
				identity = agent
			}
			dryRun, _ := cmd.Flags().GetBool("dry-run")
			return runStartCmd(cmd, "", identity, args[0], args[1:], dryRun)
		},
	}
	cmd.Flags().String("identity", "", "Central identity alias (overrides active/default identity)")
	cmd.Flags().String("agent", "", "Compatibility alias for --identity")
	cmd.Flags().Bool("dry-run", false, "Print environment and command without executing")
	return cmd
}
