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
		Use:   "start <target>",
		Short: "Start an agent session with resolved credentials",
		Long: `Start an agent session with the resolved agent's environment.
Sources the agent's .moltnet/<agent>/env file and exec's into the target binary.
Common targets: claude, codex.`,
		Example: `  moltnet start claude
  moltnet start codex
  moltnet start claude --agent legreffier
  moltnet start claude --dry-run`,
		Args: cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			dir, _ := cmd.Flags().GetString("dir")
			agent, _ := cmd.Flags().GetString("agent")
			dryRun, _ := cmd.Flags().GetBool("dry-run")
			return runStartCmd(cmd, dir, agent, args[0], dryRun)
		},
	}
	cmd.Flags().String("agent", "", "Agent name (overrides default)")
	cmd.Flags().String("dir", ".", "Repository root directory")
	cmd.Flags().Bool("dry-run", false, "Print environment and command without executing")
	return cmd
}
