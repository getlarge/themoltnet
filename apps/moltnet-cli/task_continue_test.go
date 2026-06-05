package main

import (
	"context"
	"encoding/json"
	"strings"
	"sync"
	"testing"

	"github.com/go-faster/jx"
	"github.com/google/uuid"

	moltnetapi "github.com/getlarge/themoltnet/libs/moltnet-api-client"
)

// stubContinueHandler stubs the minimum surface that `tasks continue`
// exercises: GetTask (to read the source) and CreateTask (to enqueue the
// continuation). State is captured so tests can assert on the
// CreateTaskReq the server would have received.
type stubContinueHandler struct {
	moltnetapi.UnimplementedHandler

	mu          sync.Mutex
	source      *moltnetapi.Task
	getCalls    int
	getParams   moltnetapi.GetTaskParams
	createCalls int
	lastCreate  *moltnetapi.CreateTaskReq
	// When set, GetTask returns this error response instead of source.
	getErr moltnetapi.GetTaskRes
	// When set, CreateTask returns this error response instead of a Task.
	createErr moltnetapi.CreateTaskRes
}

func (h *stubContinueHandler) GetTask(_ context.Context, params moltnetapi.GetTaskParams) (moltnetapi.GetTaskRes, error) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.getCalls++
	h.getParams = params
	if h.getErr != nil {
		return h.getErr, nil
	}
	return h.source, nil
}

func (h *stubContinueHandler) CreateTask(_ context.Context, req *moltnetapi.CreateTaskReq) (moltnetapi.CreateTaskRes, error) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.createCalls++
	cp := *req
	h.lastCreate = &cp
	if h.createErr != nil {
		return h.createErr, nil
	}
	return newTaskFixture(uuid.Nil, req.TeamId), nil
}

// freeformSourceFixture is a completed freeform Task suitable for use as
// a continuation source. Inherits correlation, allowed-executors, trust
// level, and team/diary from a shared set of constants so tests can assert
// that the continuation copied them correctly.
func freeformSourceFixture(id, teamID, diaryID, correlationID uuid.UUID) *moltnetapi.Task {
	src := newTaskFixture(id, teamID)
	src.TaskType = "freeform"
	src.Status = moltnetapi.TaskStatusCompleted
	src.DiaryId.SetTo(diaryID)
	src.CorrelationId.SetTo(correlationID)
	src.AllowedExecutors = []moltnetapi.TaskAllowedExecutorsItem{
		{Provider: "anthropic", Model: "claude-opus-4-7"},
	}
	src.RequiredExecutorTrustLevel = moltnetapi.TaskRequiredExecutorTrustLevelAgentSigned
	return src
}

func TestRunTaskContinue_HappyPath(t *testing.T) {
	srcID := uuid.MustParse("11111111-1111-4111-8111-111111111111")
	teamID := uuid.MustParse("22222222-2222-4222-8222-222222222222")
	diaryID := uuid.MustParse("33333333-3333-4333-8333-333333333333")
	corrID := uuid.MustParse("44444444-4444-4444-8444-444444444444")

	h := &stubContinueHandler{source: freeformSourceFixture(srcID, teamID, diaryID, corrID)}
	_, _, client := newTestServer(t, h)

	opts := taskContinueOpts{
		fromTaskID:     srcID.String(),
		fromAttemptN:   1,
		brief:          "Continue the work",
		title:          "Round 2",
		titleSet:       true,
		outputMode:     "json",
		skipValidation: true, // Stub server doesn't publish schemas
	}
	err := runTaskContinueWithClient(context.Background(), client, opts)
	if err != nil {
		t.Fatalf("runTaskContinueWithClient: %v", err)
	}

	if h.getCalls != 1 {
		t.Errorf("GetTask calls = %d, want 1", h.getCalls)
	}
	if h.getParams.ID != srcID {
		t.Errorf("GetTask id = %s, want %s", h.getParams.ID, srcID)
	}
	if h.createCalls != 1 {
		t.Errorf("CreateTask calls = %d, want 1", h.createCalls)
	}

	got := h.lastCreate
	if got.TaskType != "freeform" {
		t.Errorf("taskType = %q, want freeform", got.TaskType)
	}
	if got.TeamId != teamID {
		t.Errorf("teamId = %s, want %s", got.TeamId, teamID)
	}
	if !got.CorrelationId.IsSet() || got.CorrelationId.Value != corrID {
		t.Errorf("correlationId = %v, want %s", got.CorrelationId, corrID)
	}

	// Inherited executor pinning.
	if len(got.AllowedExecutors) != 1 ||
		got.AllowedExecutors[0].Provider != "anthropic" ||
		got.AllowedExecutors[0].Model != "claude-opus-4-7" {
		t.Errorf("allowedExecutors = %+v, want anthropic/claude-opus-4-7", got.AllowedExecutors)
	}
	if !got.RequiredExecutorTrustLevel.IsSet() ||
		got.RequiredExecutorTrustLevel.Value != moltnetapi.ExecutorTrustLevelAgentSigned {
		t.Errorf("trustLevel = %v, want agentSigned", got.RequiredExecutorTrustLevel)
	}

	// Auto-injected claim condition.
	cc, ok := got.ClaimCondition.Get()
	if !ok {
		t.Fatalf("ClaimCondition not set")
	}
	if !cc.IsClaimConditionTaskStatus() {
		t.Fatalf("ClaimCondition type = %v, want task_status", cc.Type)
	}
	ts, _ := cc.GetClaimConditionTaskStatus()
	if ts.TaskId != srcID {
		t.Errorf("claimCondition.taskId = %s, want %s (source id)", ts.TaskId, srcID)
	}
	if len(ts.Statuses) != 1 || ts.Statuses[0] != moltnetapi.TaskStatusCompleted {
		t.Errorf("claimCondition.statuses = %v, want [completed]", ts.Statuses)
	}

	// Input shape.
	brief, ok := got.Input["brief"]
	if !ok {
		t.Fatalf("input.brief missing")
	}
	if !strings.Contains(string(brief), "Continue the work") {
		t.Errorf("input.brief = %s, want substring 'Continue the work'", brief)
	}
	title, ok := got.Input["title"]
	if !ok {
		t.Fatalf("input.title missing despite --title set")
	}
	if !strings.Contains(string(title), "Round 2") {
		t.Errorf("input.title = %s, want substring 'Round 2'", title)
	}
	cfRaw, ok := got.Input["continueFrom"]
	if !ok {
		t.Fatalf("input.continueFrom missing")
	}
	var cf map[string]any
	if err := json.Unmarshal(cfRaw, &cf); err != nil {
		t.Fatalf("decode continueFrom: %v", err)
	}
	if cf["taskId"] != srcID.String() {
		t.Errorf("continueFrom.taskId = %v, want %s", cf["taskId"], srcID)
	}
	if cf["attemptN"].(float64) != 1 {
		t.Errorf("continueFrom.attemptN = %v, want 1", cf["attemptN"])
	}
	if _, modeSent := cf["mode"]; modeSent {
		t.Errorf("continueFrom.mode should be omitted when caller did not pass --mode")
	}
}

func TestRunTaskContinue_WithModeAndExecution(t *testing.T) {
	srcID := uuid.MustParse("11111111-1111-4111-8111-111111111111")
	teamID := uuid.MustParse("22222222-2222-4222-8222-222222222222")
	diaryID := uuid.MustParse("33333333-3333-4333-8333-333333333333")
	corrID := uuid.MustParse("44444444-4444-4444-8444-444444444444")

	h := &stubContinueHandler{source: freeformSourceFixture(srcID, teamID, diaryID, corrID)}
	_, _, client := newTestServer(t, h)

	err := runTaskContinueWithClient(context.Background(), client, taskContinueOpts{
		fromTaskID:         srcID.String(),
		fromAttemptN:       2,
		brief:              "Branch from completed parent",
		mode:               "extend",
		modeSet:            true,
		executionWorkspace: "dedicated_worktree",
		outputMode:         "id",
		skipValidation:     true,
	})
	if err != nil {
		t.Fatalf("runTaskContinueWithClient: %v", err)
	}

	cf := h.lastCreate.Input["continueFrom"]
	if !strings.Contains(string(cf), `"mode":"extend"`) {
		t.Errorf("continueFrom missing mode=extend: %s", cf)
	}
	if !strings.Contains(string(cf), `"attemptN":2`) {
		t.Errorf("continueFrom missing attemptN=2: %s", cf)
	}

	exec := h.lastCreate.Input["execution"]
	if !strings.Contains(string(exec), `"workspace":"dedicated_worktree"`) {
		t.Errorf("execution.workspace = %s, want dedicated_worktree", exec)
	}
}

func TestRunTaskContinue_RejectsForkMode(t *testing.T) {
	// The Go CLI should reject fork mode locally before the server hop,
	// matching the rejection the MCP tool and async validator do. Saves the
	// caller a round-trip and produces a clearer error.
	srcID := uuid.MustParse("11111111-1111-4111-8111-111111111111")
	h := &stubContinueHandler{source: freeformSourceFixture(
		srcID, uuid.New(), uuid.New(), uuid.New())}
	_, _, client := newTestServer(t, h)

	err := runTaskContinueWithClient(context.Background(), client, taskContinueOpts{
		fromTaskID:     srcID.String(),
		fromAttemptN:   1,
		brief:          "x",
		mode:           "fork",
		modeSet:        true,
		skipValidation: true,
	})
	if err == nil {
		t.Fatal("expected error for mode=fork, got nil")
	}
	if !strings.Contains(err.Error(), "fork") || !strings.Contains(err.Error(), "1293") {
		t.Errorf("error = %q, want substring 'fork' and '1293'", err)
	}
	if h.getCalls != 0 {
		t.Errorf("unexpected GetTask calls = %d, want 0 (fork should be caught locally)", h.getCalls)
	}
	if h.createCalls != 0 {
		t.Errorf("unexpected CreateTask calls = %d, want 0", h.createCalls)
	}
}

func TestRunTaskContinue_RejectsBlankBrief(t *testing.T) {
	srcID := uuid.MustParse("11111111-1111-4111-8111-111111111111")
	h := &stubContinueHandler{source: freeformSourceFixture(
		srcID, uuid.New(), uuid.New(), uuid.New())}
	_, _, client := newTestServer(t, h)

	err := runTaskContinueWithClient(context.Background(), client, taskContinueOpts{
		fromTaskID:     srcID.String(),
		fromAttemptN:   1,
		brief:          "   ",
		skipValidation: true,
	})
	if err == nil {
		t.Fatal("expected error for blank brief, got nil")
	}
	if !strings.Contains(err.Error(), "brief") {
		t.Errorf("error = %q, want substring 'brief'", err)
	}
}

func TestRunTaskContinue_RejectsBadFromTaskID(t *testing.T) {
	h := &stubContinueHandler{}
	_, _, client := newTestServer(t, h)

	err := runTaskContinueWithClient(context.Background(), client, taskContinueOpts{
		fromTaskID:     "not-a-uuid",
		fromAttemptN:   1,
		brief:          "x",
		skipValidation: true,
	})
	if err == nil {
		t.Fatal("expected error for invalid --from-task-id, got nil")
	}
	if !strings.Contains(err.Error(), "from-task-id") {
		t.Errorf("error = %q, want substring 'from-task-id'", err)
	}
}

func TestRunTaskContinue_RejectsBadAttemptN(t *testing.T) {
	h := &stubContinueHandler{}
	_, _, client := newTestServer(t, h)

	err := runTaskContinueWithClient(context.Background(), client, taskContinueOpts{
		fromTaskID:     "11111111-1111-4111-8111-111111111111",
		fromAttemptN:   0,
		brief:          "x",
		skipValidation: true,
	})
	if err == nil {
		t.Fatal("expected error for --from-attempt-n=0, got nil")
	}
	if !strings.Contains(err.Error(), "attempt") {
		t.Errorf("error = %q, want substring 'attempt'", err)
	}
}

func TestRunTaskContinue_SourceNotFreeform(t *testing.T) {
	srcID := uuid.MustParse("11111111-1111-4111-8111-111111111111")
	src := newTaskFixture(srcID, uuid.New())
	src.TaskType = "fulfill_brief"
	src.Status = moltnetapi.TaskStatusCompleted

	h := &stubContinueHandler{source: src}
	_, _, client := newTestServer(t, h)

	err := runTaskContinueWithClient(context.Background(), client, taskContinueOpts{
		fromTaskID:     srcID.String(),
		fromAttemptN:   1,
		brief:          "x",
		skipValidation: true,
	})
	if err == nil {
		t.Fatal("expected error for non-freeform source, got nil")
	}
	if !strings.Contains(err.Error(), "freeform") {
		t.Errorf("error = %q, want substring 'freeform'", err)
	}
	if h.createCalls != 0 {
		t.Errorf("CreateTask should not have been called (got %d)", h.createCalls)
	}
}

func TestRunTaskContinue_DryRun(t *testing.T) {
	srcID := uuid.MustParse("11111111-1111-4111-8111-111111111111")
	h := &stubContinueHandler{source: freeformSourceFixture(
		srcID, uuid.New(), uuid.New(), uuid.New())}
	_, _, client := newTestServer(t, h)

	var out strings.Builder
	err := runTaskContinueWithClient(context.Background(), client, taskContinueOpts{
		fromTaskID:     srcID.String(),
		fromAttemptN:   1,
		brief:          "Dry-run probe",
		dryRun:         true,
		outputMode:     "json",
		out:            &out,
		skipValidation: true,
	})
	if err != nil {
		t.Fatalf("runTaskContinueWithClient: %v", err)
	}
	if h.createCalls != 0 {
		t.Errorf("CreateTask should not have been called in dry-run (got %d)", h.createCalls)
	}

	body := out.String()
	if !strings.Contains(body, `"taskType": "freeform"`) {
		t.Errorf("dry-run output missing taskType=freeform: %s", body)
	}
	if !strings.Contains(body, `"continueFrom"`) {
		t.Errorf("dry-run output missing continueFrom: %s", body)
	}
	if !strings.Contains(body, `"claimCondition"`) {
		t.Errorf("dry-run output missing claimCondition: %s", body)
	}
}

func TestRunTaskContinue_ConstraintsAndExpectedOutput(t *testing.T) {
	srcID := uuid.MustParse("11111111-1111-4111-8111-111111111111")
	h := &stubContinueHandler{source: freeformSourceFixture(
		srcID, uuid.New(), uuid.New(), uuid.New())}
	_, _, client := newTestServer(t, h)

	err := runTaskContinueWithClient(context.Background(), client, taskContinueOpts{
		fromTaskID:     srcID.String(),
		fromAttemptN:   1,
		brief:          "x",
		expectedOutput: "A markdown summary",
		expectedSet:    true,
		constraints:    []string{"no PRs", "stay under 10 minutes"},
		skipValidation: true,
	})
	if err != nil {
		t.Fatalf("runTaskContinueWithClient: %v", err)
	}

	got := h.lastCreate
	expected, ok := got.Input["expectedOutput"]
	if !ok {
		t.Fatalf("expectedOutput missing")
	}
	if !strings.Contains(string(expected), "markdown summary") {
		t.Errorf("expectedOutput = %s", expected)
	}

	constraints, ok := got.Input["constraints"]
	if !ok {
		t.Fatalf("constraints missing")
	}
	var arr []string
	if err := json.Unmarshal(constraints, &arr); err != nil {
		t.Fatalf("decode constraints: %v", err)
	}
	if len(arr) != 2 || arr[0] != "no PRs" || arr[1] != "stay under 10 minutes" {
		t.Errorf("constraints = %v", arr)
	}
}

// Smoke test for jx import — ensures the test file compiles without an
// unused-import error when jx is only used inside helper fixtures elsewhere.
var _ = jx.Raw{}
