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
	taskCmd.AddCommand(newTaskAttemptsCmd())
	taskCmd.AddCommand(newTaskSchemasCmd())
	taskCmd.AddCommand(newTaskCreateCmd())
	taskCmd.AddCommand(newTaskContinueCmd())

	return taskCmd
}

func newTaskContinueCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "continue",
		Short: "Continue a completed freeform task with warm Pi-session resume",
		Long: `Create a freeform continuation of a prior freeform attempt via warm
Pi-session resume (issue #1287).

This is client-side composition over POST /tasks: the CLI fetches the
source task, builds a CreateTaskReq that points input.continueFrom at
the named attempt, auto-injects a task_status:completed claim condition
on the parent, and inherits correlationId / allowedExecutors /
requiredExecutorTrustLevel from the source. There is no dedicated
server endpoint.

The auto-injected claim condition is load-bearing: it closes the race
between reading the source state and the server persisting the create,
so a continuation cannot be claimed once the parent leaves 'completed'.

Use --mode fork to request copy-on-write (sessionDir + worktree clone);
v1 rejects this locally with a pointer to #1293.

Use --execution-workspace to override the daemon's workspace mode for
this continuation. Recognized values: none (scratch_mount), shared_mount,
dedicated_worktree. Omit to inherit the freeform default (shared_mount).`,
		Example: `  # Continue attempt 1 of a completed freeform task
  moltnet task continue \
    --from-task-id <uuid> --from-attempt-n 1 \
    --brief "Next step: render the rebased branch and run the harness"

  # Pre-populate a continuation with a tighter brief + execution override
  moltnet task continue \
    --from-task-id <uuid> --from-attempt-n 1 \
    --brief "Reduce the test surface" \
    --title "Round 2" \
    --constraint "no PR" --constraint "stay under 10 minutes" \
    --execution-workspace dedicated_worktree

  # Dry-run prints the CreateTaskReq without posting; useful in scripts
  moltnet task continue \
    --from-task-id <uuid> --from-attempt-n 1 \
    --brief "Probe" --dry-run

  # Capture just the new task id
  TASK=$(moltnet task continue \
    --from-task-id <uuid> --from-attempt-n 1 \
    --brief "Probe" --output id)`,
		Args: cobra.NoArgs,
		RunE: func(cmd *cobra.Command, args []string) error {
			credPath := flagString(cmd, "credentials")
			opts := taskContinueOpts{
				apiURL:             resolveAPIURL(cmd, credPath),
				credPath:           credPath,
				fromTaskID:         flagString(cmd, "from-task-id"),
				fromAttemptN:       flagInt(cmd, "from-attempt-n"),
				brief:              flagString(cmd, "brief"),
				title:              flagString(cmd, "title"),
				titleSet:           cmd.Flags().Changed("title"),
				expectedOutput:     flagString(cmd, "expected-output"),
				expectedSet:        cmd.Flags().Changed("expected-output"),
				constraints:        flagStringArray(cmd, "constraint"),
				executionWorkspace: flagString(cmd, "execution-workspace"),
				mode:               flagString(cmd, "mode"),
				modeSet:            cmd.Flags().Changed("mode"),
				skipValidation:     flagBool(cmd, "skip-validation"),
				dryRun:             flagBool(cmd, "dry-run"),
				outputMode:         flagString(cmd, "output"),
				out:                cmd.OutOrStdout(),
			}
			if !cmd.Flags().Changed("from-attempt-n") {
				opts.fromAttemptN = 1
			}
			return runTaskContinueCmd(opts)
		},
	}
	cmd.Flags().String("from-task-id", "", "Source task UUID (required)")
	cmd.Flags().Int("from-attempt-n", 1, "Source attempt number (≥1, default 1)")
	cmd.Flags().String("brief", "", "Brief for the continuation (required)")
	cmd.Flags().String("title", "", "Optional operator-facing title")
	cmd.Flags().String("expected-output", "", "Optional expected-output prose")
	cmd.Flags().StringArray("constraint", nil, "Constraint string; repeatable")
	cmd.Flags().String("execution-workspace", "", "Workspace mode override: none|shared_mount|dedicated_worktree")
	cmd.Flags().String("mode", "", "Continuation mode: extend (default)|fork (rejected in v1; see #1293)")
	cmd.Flags().Bool("skip-validation", false, "Skip client-side JSON Schema validation of the constructed input")
	cmd.Flags().Bool("dry-run", false, "Print the canonical CreateTaskReq and exit; no POST")
	cmd.Flags().String("output", "json", `Result rendering: "json" (full task) or "id" (UUID only)`)
	_ = cmd.MarkFlagRequired("from-task-id")
	_ = cmd.MarkFlagRequired("brief")
	return cmd
}

func newTaskCreateCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "create",
		Short: "Create and enqueue a task",
		Long: `Create a task via POST /tasks.

The schema-varying ` + "`input`" + ` blob is read from --input-file (a path, or "-"
for stdin which is also the default). Every other field of CreateTaskReq is a
flag.

Before the POST, the CLI validates ` + "`input`" + ` against the server-published JSON
Schema for the requested task type (GET /tasks/schemas). Pass --skip-validation
to opt out (e.g. when developing a new task type whose schema isn't deployed
yet). Validation errors are printed as JSON-Pointer-prefixed lines so you can
fix the file quickly.

--reference and --allowed-executor are repeatable; each value is a JSON object
matching the respective wire schema. JSON-blob flags are ugly in the shell but
lossless for the nested external object on TaskRef and the tightly-coupled
provider+model pair on ExecutorRef.`,
		Example: `  # Stdin input (default)
  echo '{"brief":"Fix issue #123","title":"...","scopeHint":"misc"}' \
    | moltnet task create --task-type fulfill_brief \
        --team-id <uuid> --diary-id <uuid>

  # File input
  moltnet task create --task-type fulfill_brief \
    --team-id <uuid> --diary-id <uuid> \
    --input-file ./brief.json

  # With a judged-work reference (assess_brief)
  moltnet task create --task-type assess_brief \
    --team-id <uuid> --diary-id <uuid> --correlation-id <uuid> \
    --reference '{"taskId":"<uuid>","role":"judged_work","outputCid":"<cid>"}' \
    --input-file ./assess-input.json

  # Restrict executors (repeatable)
  moltnet task create --task-type fulfill_brief \
    --team-id <uuid> --diary-id <uuid> \
    --allowed-executor '{"provider":"openai-codex","model":"gpt-5.3-codex"}' \
    --allowed-executor '{"provider":"anthropic","model":"claude-opus-4-7"}' \
    --input-file ./brief.json

  # Dry-run prints the canonical CreateTaskReq without posting
  moltnet task create --task-type fulfill_brief \
    --team-id <uuid> --diary-id <uuid> --dry-run \
    --input-file ./brief.json

  # Capture just the task id in a shell variable
  TASK=$(moltnet task create --task-type fulfill_brief \
    --team-id <uuid> --diary-id <uuid> \
    --input-file ./brief.json --output id)`,
		Args: cobra.NoArgs,
		RunE: func(cmd *cobra.Command, args []string) error {
			credPath := flagString(cmd, "credentials")
			opts := taskCreateOpts{
				apiURL:                        resolveAPIURL(cmd, credPath),
				credPath:                      credPath,
				taskType:                      flagString(cmd, "task-type"),
				teamID:                        flagString(cmd, "team-id"),
				diaryID:                       flagString(cmd, "diary-id"),
				inputFile:                     flagString(cmd, "input-file"),
				correlationID:                 flagString(cmd, "correlation-id"),
				correlationIDSet:              cmd.Flags().Changed("correlation-id"),
				references:                    flagStringArray(cmd, "reference"),
				allowedExecutors:              flagStringArray(cmd, "allowed-executor"),
				requiredExecutorTrustLevel:    flagString(cmd, "required-executor-trust-level"),
				requiredExecutorTrustLevelSet: cmd.Flags().Changed("required-executor-trust-level"),
				dispatchTimeoutSec:            flagInt(cmd, "dispatch-timeout-sec"),
				dispatchTimeoutSecSet:         cmd.Flags().Changed("dispatch-timeout-sec"),
				runningTimeoutSec:             flagInt(cmd, "running-timeout-sec"),
				runningTimeoutSecSet:          cmd.Flags().Changed("running-timeout-sec"),
				expiresInSec:                  flagInt(cmd, "expires-in-sec"),
				expiresInSecSet:               cmd.Flags().Changed("expires-in-sec"),
				maxAttempts:                   flagInt(cmd, "max-attempts"),
				maxAttemptsSet:                cmd.Flags().Changed("max-attempts"),
				skipValidation:                flagBool(cmd, "skip-validation"),
				dryRun:                        flagBool(cmd, "dry-run"),
				outputMode:                    flagString(cmd, "output"),
				out:                           cmd.OutOrStdout(),
			}
			return runTaskCreateCmd(opts)
		},
	}
	cmd.Flags().String("task-type", "", "Task type name (required)")
	cmd.Flags().String("team-id", "", "Team UUID (required)")
	cmd.Flags().String("diary-id", "", "Diary UUID (required)")
	cmd.Flags().String("input-file", "-", `Path to the input JSON blob; "-" reads stdin (default)`)
	cmd.Flags().String("correlation-id", "", "Correlation UUID — link this task to an existing chain")
	cmd.Flags().StringArray("reference", nil, "TaskRef JSON object; repeatable")
	cmd.Flags().StringArray("allowed-executor", nil, "ExecutorRef JSON object; repeatable")
	cmd.Flags().String("required-executor-trust-level", "", "One of: selfDeclared, agentSigned, releaseVerifiedTool, sandboxAttested")
	cmd.Flags().Int("dispatch-timeout-sec", 0, "Override dispatch timeout (seconds)")
	cmd.Flags().Int("running-timeout-sec", 0, "Override running timeout (seconds)")
	cmd.Flags().Int("expires-in-sec", 0, "Task expiry from enqueue (seconds)")
	cmd.Flags().Int("max-attempts", 0, "Override max attempts")
	cmd.Flags().Bool("skip-validation", false, "Skip client-side JSON Schema validation of --input-file")
	cmd.Flags().Bool("dry-run", false, "Print the canonical CreateTaskReq and exit; no POST")
	cmd.Flags().String("output", "json", `Result rendering: "json" (full task) or "id" (UUID only)`)
	_ = cmd.MarkFlagRequired("task-type")
	_ = cmd.MarkFlagRequired("team-id")
	_ = cmd.MarkFlagRequired("diary-id")
	return cmd
}

func newTaskSchemasCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "schemas",
		Short: "List task type input schemas, or print one schema",
		Long: `List registered task types with their input JSON Schemas, schema CIDs,
and output kinds.

With no flags, prints a JSON array of descriptors (taskType, outputKind,
inputSchemaCid). With --task-type, prints just that type's input schema
as JSON, suitable for piping into jq or feeding into an editor for input
authoring.`,
		Example: `  # All task types
  moltnet task schemas

  # One task type's input schema
  moltnet task schemas --task-type fulfill_brief | jq .`,
		Args: cobra.NoArgs,
		RunE: func(cmd *cobra.Command, args []string) error {
			credPath := flagString(cmd, "credentials")
			apiURL := resolveAPIURL(cmd, credPath)
			taskType := flagString(cmd, "task-type")
			if taskType != "" {
				return runTaskSchemasGetCmd(taskSchemasGetOpts{
					apiURL:   apiURL,
					credPath: credPath,
					taskType: taskType,
					out:      cmd.OutOrStdout(),
				})
			}
			return runTaskSchemasListCmd(taskSchemasListOpts{
				apiURL:   apiURL,
				credPath: credPath,
				out:      cmd.OutOrStdout(),
			})
		},
	}
	cmd.Flags().String("task-type", "", "Print only this task type's input schema (raw JSON)")
	return cmd
}

func newTaskAttemptsCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "attempts <task-id>",
		Short: "List attempts for a task",
		Long: `List attempts for a task — including each attempt's output payload.

` + "`moltnet task get`" + ` returns the task envelope (status, acceptedAttemptN)
but does not embed attempt payloads. Use this command to inspect what an
accepted attempt actually produced (judgment JSON, generated artifact, etc.)
without spinning up a one-off SDK script.`,
		Example: `  # All attempts (JSON array)
  moltnet task attempts <task-uuid>

  # Just the accepted attempt (single object, not array)
  moltnet task attempts <task-uuid> --accepted-only

  # Just the accepted attempt's output field — pipe straight into jq
  moltnet task attempts <task-uuid> --accepted-only --field output`,
		Args: cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			credPath := flagString(cmd, "credentials")
			return runTaskAttemptsCmd(taskAttemptsOpts{
				apiURL:       resolveAPIURL(cmd, credPath),
				credPath:     credPath,
				taskID:       args[0],
				acceptedOnly: flagBool(cmd, "accepted-only"),
				field:        flagString(cmd, "field"),
				out:          cmd.OutOrStdout(),
			})
		},
	}
	cmd.Flags().Bool("accepted-only", false, "Return only the accepted attempt (single object, not an array)")
	cmd.Flags().String("field", "", "Print only one field of the selected attempt (one of: output, outputCid, error, status, attemptN). Requires --accepted-only when there are multiple attempts")
	return cmd
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
			credPath := flagString(cmd, "credentials")
			opts := taskListOpts{
				apiURL:               resolveAPIURL(cmd, credPath),
				credPath:             credPath,
				teamID:               flagString(cmd, "team-id"),
				taskTypes:            flagStringSlice(cmd, "task-types"),
				taskTypeAliases:      flagStringArray(cmd, "task-type"),
				status:               flagString(cmd, "status"),
				diaryID:              flagString(cmd, "diary-id"),
				correlationID:        flagString(cmd, "correlation-id"),
				proposedByAgentID:    flagString(cmd, "proposed-by-agent-id"),
				proposedByHumanID:    flagString(cmd, "proposed-by-human-id"),
				claimedByAgentID:     flagString(cmd, "claimed-by-agent-id"),
				provider:             flagString(cmd, "provider"),
				model:                flagString(cmd, "model"),
				hasAttempts:          flagBool(cmd, "has-attempts"),
				hasAttemptsSet:       cmd.Flags().Changed("has-attempts"),
				queuedAfter:          flagString(cmd, "queued-after"),
				queuedBefore:         flagString(cmd, "queued-before"),
				completedAfter:       flagString(cmd, "completed-after"),
				completedBefore:      flagString(cmd, "completed-before"),
				limit:                flagInt(cmd, "limit"),
				limitSet:             cmd.Flags().Changed("limit"),
				cursor:               flagString(cmd, "cursor"),
				cursorSet:            cmd.Flags().Changed("cursor"),
				taskTypesSet:         cmd.Flags().Changed("task-types"),
				taskTypeAliasesSet:   cmd.Flags().Changed("task-type"),
				statusSet:            cmd.Flags().Changed("status"),
				diaryIDSet:           cmd.Flags().Changed("diary-id"),
				correlationIDSet:     cmd.Flags().Changed("correlation-id"),
				proposedByAgentIDSet: cmd.Flags().Changed("proposed-by-agent-id"),
				proposedByHumanIDSet: cmd.Flags().Changed("proposed-by-human-id"),
				claimedByAgentIDSet:  cmd.Flags().Changed("claimed-by-agent-id"),
				providerSet:          cmd.Flags().Changed("provider"),
				modelSet:             cmd.Flags().Changed("model"),
				queuedAfterSet:       cmd.Flags().Changed("queued-after"),
				queuedBeforeSet:      cmd.Flags().Changed("queued-before"),
				completedAfterSet:    cmd.Flags().Changed("completed-after"),
				completedBeforeSet:   cmd.Flags().Changed("completed-before"),
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
	cmd.Flags().String("proposed-by-agent-id", "", "Filter by proposing agent UUID")
	cmd.Flags().String("proposed-by-human-id", "", "Filter by proposing human UUID")
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
			credPath := flagString(cmd, "credentials")
			return runTaskGetCmd(
				resolveAPIURL(cmd, credPath),
				credPath,
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
			credPath, _ := cmd.Flags().GetString("credentials")
			apiURL := resolveAPIURL(cmd, credPath)
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
