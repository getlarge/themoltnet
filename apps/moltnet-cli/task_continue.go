package main

// task continue — client-side composition over POST /tasks for warm
// Pi-session continuations. The CLI mirrors the MCP tool's logic
// (apps/mcp-server/src/task-tools.ts → handleTasksContinue): read the
// source via GetTask, build a CreateTaskReq with continueFrom +
// inherited correlation/profile pinning + auto-injected
// task_status:completed claim condition on the parent, then POST.
//
// The shape parallels task_create.go so the two commands feel uniform
// to operators. Validation that would normally be a server-side hop
// (fork-mode rejection, source-must-be-freeform) is done locally where
// possible so callers get an immediate error.

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"strings"

	"github.com/go-faster/jx"
	"github.com/google/uuid"

	moltnetapi "github.com/getlarge/themoltnet/libs/moltnet-api-client"
)

type taskContinueOpts struct {
	apiURL   string
	credPath string

	fromTaskID   string
	fromAttemptN int

	brief string

	title    string
	titleSet bool

	expectedOutput string
	expectedSet    bool

	constraints []string

	mode    string
	modeSet bool

	skipValidation bool
	dryRun         bool
	outputMode     string

	out io.Writer
}

func runTaskContinueCmd(opts taskContinueOpts) error {
	client, err := newClientFromCreds(opts.apiURL, opts.credPath)
	if err != nil {
		return err
	}
	return runTaskContinueWithClient(context.Background(), client, opts)
}

func runTaskContinueWithClient(ctx context.Context, client *moltnetapi.Client, opts taskContinueOpts) error {
	if opts.out == nil {
		opts.out = os.Stdout
	}

	// Local pre-flight checks. Anything we can reject without a network
	// hop saves the operator a round-trip and produces a sharper error.
	if strings.TrimSpace(opts.brief) == "" {
		return fmt.Errorf("--brief is required and must not be blank")
	}
	if opts.fromAttemptN < 1 {
		return fmt.Errorf("--from-attempt-n must be ≥ 1 (got %d)", opts.fromAttemptN)
	}
	fromTaskID, err := uuid.Parse(opts.fromTaskID)
	if err != nil {
		return fmt.Errorf("invalid --from-task-id %q: %w", opts.fromTaskID, err)
	}
	if opts.modeSet && opts.mode != "extend" && opts.mode != "fork" {
		return fmt.Errorf(
			"--mode must be one of: extend, fork (got %q)", opts.mode)
	}
	// execution.workspace is intentionally not exposed: continuations
	// inherit workspace mode from the parent slot via the daemon's
	// maybeAttachWarmSlotContext (forces dedicated_worktree + parent
	// worktreeBranch). The async validator rejects it explicitly when
	// continueFrom is set.

	// 1. Read source.
	srcRes, err := client.GetTask(ctx, moltnetapi.GetTaskParams{ID: fromTaskID})
	if err != nil {
		return fmt.Errorf("get source task: %w", formatTransportError(err))
	}
	source, ok := srcRes.(*moltnetapi.Task)
	if !ok {
		return formatAPIError(srcRes)
	}
	if source.TaskType != "freeform" {
		// v1 is freeform → freeform only. Cross-type continuation
		// follows in #1305.
		return fmt.Errorf(
			"source task type %q is not continuable; only freeform → freeform is supported in v1",
			source.TaskType,
		)
	}

	// 2. Construct CreateTaskReq via composition.
	req, err := buildContinuationRequest(opts, source)
	if err != nil {
		return err
	}

	// 3. Client-side input schema validation against the server's
	//    published schema (skip via --skip-validation).
	if !opts.skipValidation {
		if err := validateTaskInputAgainstServer(ctx, client, "freeform", req.Input); err != nil {
			return err
		}
	}

	if opts.dryRun {
		var buf bytes.Buffer
		enc := jx.NewStreamingEncoder(&buf, 1024)
		req.Encode(enc)
		if err := enc.Close(); err != nil {
			return fmt.Errorf("encode dry-run body: %w", err)
		}
		var pretty bytes.Buffer
		if err := json.Indent(&pretty, buf.Bytes(), "", "  "); err != nil {
			return fmt.Errorf("indent dry-run body: %w", err)
		}
		_, err := fmt.Fprintln(opts.out, pretty.String())
		return err
	}

	// 4. POST via existing CreateTask.
	res, err := client.CreateTask(ctx, req)
	if err != nil {
		return fmt.Errorf("task create: %w", formatTransportError(err))
	}
	task, ok := res.(*moltnetapi.Task)
	if !ok {
		return formatAPIError(res)
	}

	switch opts.outputMode {
	case "id":
		_, err := fmt.Fprintln(opts.out, task.ID.String())
		return err
	case "", "json":
		return printJSONTo(opts.out, task)
	default:
		return fmt.Errorf("--output: unsupported value %q (one of: json, id)", opts.outputMode)
	}
}

// buildContinuationRequest projects the source task plus caller inputs
// into the CreateTaskReq the server expects. The composition mirrors the
// MCP tool's handleTasksContinue verbatim: inherit teamId / diaryId /
// correlationId / allowedProfiles / requiredExecutorTrustLevel from the
// source; auto-inject a `task_status: completed` claim condition; pack
// the caller's flags + continueFrom into `input`.
func buildContinuationRequest(opts taskContinueOpts, source *moltnetapi.Task) (*moltnetapi.CreateTaskReq, error) {
	// Already validated upstream — runTaskContinueWithClient rejects an
	// unparseable --from-task-id before we get here. Failing loudly on
	// the impossible path is friendlier than silently constructing a
	// zero UUID if invariants ever break.
	fromTaskID, err := uuid.Parse(opts.fromTaskID)
	if err != nil {
		return nil, fmt.Errorf("internal: unparseable fromTaskID %q reached buildContinuationRequest: %w", opts.fromTaskID, err)
	}

	// teamId is non-nullable on Task. diaryId is nullable on Task but the
	// CreateTaskReq treats it as required; reject if source had none.
	diaryID, hasDiary := source.DiaryId.Get()
	if !hasDiary {
		return nil, fmt.Errorf(
			"source task %s has no diaryId; cannot construct continuation",
			source.ID,
		)
	}

	input, err := buildContinuationInput(opts, fromTaskID)
	if err != nil {
		return nil, err
	}

	req := &moltnetapi.CreateTaskReq{
		TaskType: "freeform",
		TeamId:   source.TeamId,
		DiaryId:  diaryID,
		Input:    input,
	}

	if corrID, ok := source.CorrelationId.Get(); ok {
		req.CorrelationId = moltnetapi.NewOptUUID(corrID)
	}

	// Inherit profile pinning. RuntimeProfileRef and TaskAllowedProfilesItem
	// have identical shape but distinct nominal types in the generated
	// client; copy field-by-field.
	for _, profile := range source.AllowedProfiles {
		req.AllowedProfiles = append(req.AllowedProfiles, moltnetapi.RuntimeProfileRef{
			ProfileId: profile.ProfileId,
		})
	}

	// Inherit trust level. The two enums (TaskRequiredExecutorTrustLevel
	// and ExecutorTrustLevel) carry the same string values; map across.
	// Source.RequiredExecutorTrustLevel is non-nullable on the wire, so
	// an unknown value here means the source predates a new server level
	// (forward-incompat client) or the wire schema drifted. Fail closed
	// rather than silently dropping the pin — losing the trust level on
	// a continuation is a privilege relaxation we won't allow implicitly.
	lvl, ok := mapTaskTrustLevelToExecutor(source.RequiredExecutorTrustLevel)
	if !ok {
		return nil, fmt.Errorf(
			"source task %s has unrecognized requiredExecutorTrustLevel %q; refusing to drop the pin on the continuation. Upgrade the CLI to a version that knows this trust level.",
			source.ID,
			source.RequiredExecutorTrustLevel,
		)
	}
	req.RequiredExecutorTrustLevel = moltnetapi.NewOptExecutorTrustLevel(lvl)

	// Auto-inject claim condition: continuation cannot be claimed until
	// the parent reaches `completed`. Load-bearing because the GetTask
	// read at T0 and POST /tasks at T1 race against parent cancellation.
	cond := moltnetapi.ClaimCondition{}
	cond.SetClaimConditionTaskStatus(moltnetapi.ClaimConditionTaskStatus{
		Op:       moltnetapi.ClaimConditionTaskStatusOpTaskStatus,
		TaskId:   fromTaskID,
		Statuses: []moltnetapi.TaskStatus{moltnetapi.TaskStatusCompleted},
	})
	req.ClaimCondition = moltnetapi.NewOptClaimCondition(cond)

	return req, nil
}

// buildContinuationInput assembles the JSON `input` blob for the
// freeform task. Caller-set fields land verbatim; `continueFrom` is
// always present and is the load-bearing field that triggers the
// daemon's warm-resume code path.
func buildContinuationInput(opts taskContinueOpts, fromTaskID uuid.UUID) (moltnetapi.CreateTaskReqInput, error) {
	input := moltnetapi.CreateTaskReqInput{}

	briefRaw, err := json.Marshal(opts.brief)
	if err != nil {
		return nil, fmt.Errorf("marshal brief: %w", err)
	}
	input["brief"] = briefRaw

	if opts.titleSet && strings.TrimSpace(opts.title) != "" {
		titleRaw, err := json.Marshal(opts.title)
		if err != nil {
			return nil, fmt.Errorf("marshal title: %w", err)
		}
		input["title"] = titleRaw
	}

	if opts.expectedSet && strings.TrimSpace(opts.expectedOutput) != "" {
		eoRaw, err := json.Marshal(opts.expectedOutput)
		if err != nil {
			return nil, fmt.Errorf("marshal expectedOutput: %w", err)
		}
		input["expectedOutput"] = eoRaw
	}

	if len(opts.constraints) > 0 {
		cRaw, err := json.Marshal(opts.constraints)
		if err != nil {
			return nil, fmt.Errorf("marshal constraints: %w", err)
		}
		input["constraints"] = cRaw
	}

	cf := map[string]any{
		"taskId":   fromTaskID.String(),
		"attemptN": opts.fromAttemptN,
	}
	if opts.modeSet && opts.mode != "" {
		cf["mode"] = opts.mode
	}
	cfRaw, err := json.Marshal(cf)
	if err != nil {
		return nil, fmt.Errorf("marshal continueFrom: %w", err)
	}
	input["continueFrom"] = cfRaw

	return input, nil
}

// mapTaskTrustLevelToExecutor maps from the Task wire enum to the
// CreateTaskReq's ExecutorTrustLevel enum. Both have the same string
// values but different nominal types in the generated client.
func mapTaskTrustLevelToExecutor(
	lvl moltnetapi.TaskRequiredExecutorTrustLevel,
) (moltnetapi.ExecutorTrustLevel, bool) {
	switch lvl {
	case moltnetapi.TaskRequiredExecutorTrustLevelSelfDeclared:
		return moltnetapi.ExecutorTrustLevelSelfDeclared, true
	case moltnetapi.TaskRequiredExecutorTrustLevelAgentSigned:
		return moltnetapi.ExecutorTrustLevelAgentSigned, true
	case moltnetapi.TaskRequiredExecutorTrustLevelReleaseVerifiedTool:
		return moltnetapi.ExecutorTrustLevelReleaseVerifiedTool, true
	case moltnetapi.TaskRequiredExecutorTrustLevelSandboxAttested:
		return moltnetapi.ExecutorTrustLevelSandboxAttested, true
	default:
		return "", false
	}
}
