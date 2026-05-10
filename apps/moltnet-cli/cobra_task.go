package main

import (
	"github.com/spf13/cobra"
)

func newTaskCmd() *cobra.Command {
	taskCmd := &cobra.Command{
		Use:   "task",
		Short: "Task queue operations",
	}

	taskCmd.AddCommand(newTaskTailCmd())

	return taskCmd
}

func newTaskTailCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "tail <task-id>",
		Short: "Follow the per-attempt message stream of a task",
		Long: `Tail the append-only message stream of a task — useful for watching an
agent run live (CI, local dev, remote operator) without crawling Axiom or
the console UI.

Polls GET /tasks/<id>/messages with an afterSeq cursor at --interval and
prints each new message. Exits when the task reaches a terminal status
(completed / failed / cancelled / expired).

Suppresses text_delta by default to keep the output readable; pass
--show-deltas to include them.`,
		Example: `  moltnet task tail 1234abcd-...
  moltnet task tail <id> --attempt 2 --since 0
  moltnet task tail <id> --kind tool_call_start,tool_call_end,turn_end,error
  moltnet task tail <id> --format json | jq 'select(.kind == "error")'`,
		Args: cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			apiURL, _ := cmd.Flags().GetString("api-url")
			credPath, _ := cmd.Flags().GetString("credentials")
			attempt, _ := cmd.Flags().GetInt("attempt")
			since, _ := cmd.Flags().GetInt("since")
			sinceChanged := cmd.Flags().Changed("since")
			kindStr, _ := cmd.Flags().GetString("kind")
			intervalSec, _ := cmd.Flags().GetInt("interval")
			showDeltas, _ := cmd.Flags().GetBool("show-deltas")
			format, _ := cmd.Flags().GetString("format")
			return runTaskTailCmd(taskTailOpts{
				apiURL:       apiURL,
				credPath:     credPath,
				taskID:       args[0],
				attempt:      attempt,
				since:        since,
				sinceChanged: sinceChanged,
				kindFilter:   kindStr,
				intervalSec:  intervalSec,
				showDeltas:   showDeltas,
				format:       format,
				out:          cmd.OutOrStdout(),
			})
		},
	}
	cmd.Flags().Int("attempt", 0, "Attempt number to tail (default: latest)")
	cmd.Flags().Int("since", 0, "Inclusive seq cursor: print every message with seq >= this. --since 0 replays from the start (default: skip backlog, follow from now)")
	cmd.Flags().String("kind", "", "Comma-separated subset of kinds to print (default: all). One of text_delta,tool_call_start,tool_call_end,turn_end,error,info")
	cmd.Flags().Int("interval", 2, "Polling interval in seconds")
	cmd.Flags().Bool("show-deltas", false, "Include text_delta messages (verbose)")
	cmd.Flags().String("format", "human", "Output format: human | json")
	return cmd
}
