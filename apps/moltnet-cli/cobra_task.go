package main

import (
	"fmt"

	"github.com/spf13/cobra"
)

func newTaskCmd() *cobra.Command {
	taskCmd := &cobra.Command{
		Use:   "task",
		Short: "Task queue operations",
	}

	taskCmd.AddCommand(newTaskListCmd())
	taskCmd.AddCommand(newTaskGetCmd())
	taskCmd.AddCommand(newTaskTailCmd())

	return taskCmd
}

func newTaskListCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "list",
		Short: "List tasks",
		Example: `  moltnet task list --team-id <uuid>
  moltnet task list --team-id <uuid> --task-types curate_pack,fulfill_brief
  moltnet task list --team-id <uuid> --task-type curate_pack --task-type fulfill_brief
  moltnet task list --team-id <uuid> --provider openai --model gpt-5.1 --has-attempts=false`,
		Args: cobra.NoArgs,
		RunE: func(cmd *cobra.Command, args []string) error {
			opts := taskListOpts{
				apiURL:              flagString(cmd, "api-url"),
				credPath:            flagString(cmd, "credentials"),
				teamID:              flagString(cmd, "team-id"),
				taskTypes:           flagStringSlice(cmd, "task-types"),
				taskTypeAliases:     flagStringArray(cmd, "task-type"),
				status:              flagString(cmd, "status"),
				diaryID:             flagString(cmd, "diary-id"),
				correlationID:       flagString(cmd, "correlation-id"),
				imposedByAgentID:    flagString(cmd, "imposed-by-agent-id"),
				imposedByHumanID:    flagString(cmd, "imposed-by-human-id"),
				claimedByAgentID:    flagString(cmd, "claimed-by-agent-id"),
				provider:            flagString(cmd, "provider"),
				model:               flagString(cmd, "model"),
				hasAttempts:         flagBool(cmd, "has-attempts"),
				hasAttemptsSet:      cmd.Flags().Changed("has-attempts"),
				queuedAfter:         flagString(cmd, "queued-after"),
				queuedBefore:        flagString(cmd, "queued-before"),
				completedAfter:      flagString(cmd, "completed-after"),
				completedBefore:     flagString(cmd, "completed-before"),
				limit:               flagInt(cmd, "limit"),
				limitSet:            cmd.Flags().Changed("limit"),
				cursor:              flagString(cmd, "cursor"),
				cursorSet:           cmd.Flags().Changed("cursor"),
				taskTypesSet:        cmd.Flags().Changed("task-types"),
				taskTypeAliasesSet:  cmd.Flags().Changed("task-type"),
				statusSet:           cmd.Flags().Changed("status"),
				diaryIDSet:          cmd.Flags().Changed("diary-id"),
				correlationIDSet:    cmd.Flags().Changed("correlation-id"),
				imposedByAgentIDSet: cmd.Flags().Changed("imposed-by-agent-id"),
				imposedByHumanIDSet: cmd.Flags().Changed("imposed-by-human-id"),
				claimedByAgentIDSet: cmd.Flags().Changed("claimed-by-agent-id"),
				providerSet:         cmd.Flags().Changed("provider"),
				modelSet:            cmd.Flags().Changed("model"),
				queuedAfterSet:      cmd.Flags().Changed("queued-after"),
				queuedBeforeSet:     cmd.Flags().Changed("queued-before"),
				completedAfterSet:   cmd.Flags().Changed("completed-after"),
				completedBeforeSet:  cmd.Flags().Changed("completed-before"),
			}
			return runTaskListCmd(opts)
		},
	}
	cmd.Flags().String("team-id", "", "Team UUID (required)")
	cmd.Flags().StringSlice("task-types", nil, "Comma-separated task type filter; may be repeated")
	cmd.Flags().StringArray("task-type", nil, "Task type filter; may be repeated")
	cmd.Flags().String("status", "", "Filter by task status")
	cmd.Flags().String("diary-id", "", "Filter by diary UUID")
	cmd.Flags().String("correlation-id", "", "Filter by correlation UUID")
	cmd.Flags().String("imposed-by-agent-id", "", "Filter by imposing agent UUID")
	cmd.Flags().String("imposed-by-human-id", "", "Filter by imposing human UUID")
	cmd.Flags().String("claimed-by-agent-id", "", "Filter by claimed agent UUID")
	cmd.Flags().String("provider", "", "Filter by executor provider; requires --model")
	cmd.Flags().String("model", "", "Filter by executor model; requires --provider")
	cmd.Flags().Bool("has-attempts", false, "Filter by whether tasks have attempts")
	cmd.Flags().String("queued-after", "", "Filter queuedAt >= RFC3339 timestamp")
	cmd.Flags().String("queued-before", "", "Filter queuedAt <= RFC3339 timestamp")
	cmd.Flags().String("completed-after", "", "Filter completedAt >= RFC3339 timestamp")
	cmd.Flags().String("completed-before", "", "Filter completedAt <= RFC3339 timestamp")
	cmd.Flags().Int("limit", 0, "Maximum number of tasks to return")
	cmd.Flags().String("cursor", "", "Pagination cursor")
	_ = cmd.MarkFlagRequired("team-id")
	return cmd
}

func newTaskGetCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:     "get <task-id>",
		Short:   "Get a task by ID",
		Example: `  moltnet task get <task-uuid>`,
		Args:    cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			return runTaskGetCmd(
				flagString(cmd, "api-url"),
				flagString(cmd, "credentials"),
				args[0],
			)
		},
	}
	return cmd
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

func flagString(cmd *cobra.Command, name string) string {
	v, err := cmd.Flags().GetString(name)
	if err != nil {
		panic(fmt.Sprintf("flagString %q: %v", name, err))
	}
	return v
}

func flagBool(cmd *cobra.Command, name string) bool {
	v, err := cmd.Flags().GetBool(name)
	if err != nil {
		panic(fmt.Sprintf("flagBool %q: %v", name, err))
	}
	return v
}

func flagInt(cmd *cobra.Command, name string) int {
	v, err := cmd.Flags().GetInt(name)
	if err != nil {
		panic(fmt.Sprintf("flagInt %q: %v", name, err))
	}
	return v
}

func flagStringSlice(cmd *cobra.Command, name string) []string {
	v, err := cmd.Flags().GetStringSlice(name)
	if err != nil {
		panic(fmt.Sprintf("flagStringSlice %q: %v", name, err))
	}
	return v
}

func flagStringArray(cmd *cobra.Command, name string) []string {
	v, err := cmd.Flags().GetStringArray(name)
	if err != nil {
		panic(fmt.Sprintf("flagStringArray %q: %v", name, err))
	}
	return v
}
