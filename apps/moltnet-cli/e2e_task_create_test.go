//go:build e2e

package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"strings"
	"testing"
	"time"

	moltnetapi "github.com/getlarge/themoltnet/libs/moltnet-api-client"
	"github.com/google/uuid"
)

// E2E suite for `moltnet task create` and `moltnet task schemas`. Exercises
// the compiled CLI binary against the live rest-api from the e2e compose
// stack. Each test creates fresh tasks tagged with a unique correlation-id
// so cross-test isolation is per-row, not per-database.

// runE2ECLIWithStdin is the stdin-aware cousin of runE2ECLI. The task create
// command's primary input path is stdin, so the existing helper (which
// inherits the parent process's stdin) can't drive it.
func runE2ECLIWithStdin(
	binPath string,
	credsPath string,
	stdin string,
	args ...string,
) (stdout string, stderr string, runErr error) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	fullArgs := append(
		[]string{"--api-url", e2eAPIURL, "--credentials", credsPath},
		args...,
	)
	cmd := exec.CommandContext(ctx, binPath, fullArgs...)
	var outBuf, errBuf bytes.Buffer
	cmd.Stdout = &outBuf
	cmd.Stderr = &errBuf
	cmd.Stdin = strings.NewReader(stdin)
	cmd.Env = os.Environ()
	runErr = cmd.Run()
	if ctx.Err() == context.DeadlineExceeded {
		runErr = fmt.Errorf("CLI invocation timed out after 30s: %v", runErr)
	}
	return outBuf.String(), errBuf.String(), runErr
}

// taskCreateHarness adds stdin-aware helpers to the existing cliHarness.
type taskCreateHarness struct {
	*cliHarness
}

func newTaskCreateHarness(t *testing.T) *taskCreateHarness {
	t.Helper()
	return &taskCreateHarness{cliHarness: newCLIHarness(t)}
}

// runWithStdin runs the CLI with the given stdin and fails the test if it
// exits non-zero. Returns stdout, stderr.
func (h *taskCreateHarness) runWithStdin(t *testing.T, stdin string, args ...string) (string, string) {
	t.Helper()
	stdout, stderr, err := runE2ECLIWithStdin(h.bin, h.creds, stdin, args...)
	if err != nil {
		t.Fatalf(
			"CLI %v failed: %v\nstdout:\n%s\nstderr:\n%s",
			args, err, stdout, stderr,
		)
	}
	return stdout, stderr
}

// runExpectingFailure runs the CLI and asserts a non-zero exit. Returns
// stdout + stderr so the caller can pattern-match the error message.
func (h *taskCreateHarness) runExpectingFailure(
	t *testing.T, stdin string, args ...string,
) (stdout, stderr string) {
	t.Helper()
	stdout, stderr, err := runE2ECLIWithStdin(h.bin, h.creds, stdin, args...)
	if err == nil {
		t.Fatalf(
			"CLI %v unexpectedly succeeded\nstdout:\n%s\nstderr:\n%s",
			args, stdout, stderr,
		)
	}
	return stdout, stderr
}

// fulfillBriefInput returns a valid fulfill_brief input keyed off the given
// correlation id so the test row is easy to find via `tasks list`.
func fulfillBriefInput(corrID string) string {
	return fmt.Sprintf(`{
  "brief": "E2E smoke for task create — correlation %s",
  "scopeHint": "misc"
}`, corrID)
}

// TestE2E_CLI_TaskSchemas_ListsBuiltInTypes verifies the live registry
// publishes the well-known task types the CLI's downstream callers depend on.
func TestE2E_CLI_TaskSchemas_ListsBuiltInTypes(t *testing.T) {
	h := newCLIHarness(t)
	stdout, _ := h.run(t, "task", "schemas")

	var rows []struct {
		TaskType       string `json:"taskType"`
		OutputKind     string `json:"outputKind"`
		InputSchemaCid string `json:"inputSchemaCid"`
	}
	decodeJSON(t, stdout, &rows)
	if len(rows) == 0 {
		t.Fatalf("task schemas returned no rows")
	}

	got := make(map[string]bool, len(rows))
	for _, r := range rows {
		got[r.TaskType] = true
		if r.InputSchemaCid == "" {
			t.Errorf("row %q has empty inputSchemaCid", r.TaskType)
		}
	}
	want := []string{
		"fulfill_brief", "assess_brief", "curate_pack", "render_pack",
		"judge_pack", "run_eval", "judge_eval_attempt", "pr_review",
	}
	for _, name := range want {
		if !got[name] {
			t.Errorf("schemas listing missing built-in task type %q", name)
		}
	}
}

// TestE2E_CLI_TaskSchemas_GetByType verifies --task-type returns one
// schema object suitable for piping into jq.
func TestE2E_CLI_TaskSchemas_GetByType(t *testing.T) {
	h := newCLIHarness(t)
	stdout, _ := h.run(t, "task", "schemas", "--task-type", "fulfill_brief")

	var schema map[string]any
	decodeJSON(t, stdout, &schema)
	if schema["type"] != "object" {
		t.Errorf("expected schema.type = object, got %v", schema["type"])
	}
	if _, ok := schema["properties"]; !ok {
		t.Errorf("expected schema.properties to be present, got keys %v", mapKeys(schema))
	}
}

// TestE2E_CLI_TaskCreate_Happy creates a real fulfill_brief task and
// asserts it lands in the queue with the right shape.
func TestE2E_CLI_TaskCreate_Happy(t *testing.T) {
	h := newTaskCreateHarness(t)
	corr := uuid.NewString()
	stdout, _ := h.runWithStdin(t, fulfillBriefInput(corr),
		"task", "create",
		"--task-type", "fulfill_brief",
		"--team-id", e2ePersonalTeamID.String(),
		"--diary-id", e2eDiaryID.String(),
		"--title", "E2E task create smoke",
		"--correlation-id", corr,
	)

	var task moltnetapi.Task
	decodeJSON(t, stdout, &task)
	if task.ID == uuid.Nil {
		t.Fatalf("task missing id; stdout:\n%s", stdout)
	}
	if task.TaskType != "fulfill_brief" {
		t.Errorf("Task.TaskType = %q, want fulfill_brief", task.TaskType)
	}
	if task.Status != moltnetapi.TaskStatusQueued {
		t.Errorf("Task.Status = %q, want queued", task.Status)
	}
	corrVal, _ := task.CorrelationId.Get()
	if corrVal.String() != corr {
		t.Errorf("Task.CorrelationId = %q, want %q", corrVal, corr)
	}

	// Sanity: a follow-up `tasks list --correlation-id` returns exactly one row.
	listed, err := e2eClient.ListTasks(context.Background(), moltnetapi.ListTasksParams{
		XMoltnetTeamID: e2ePersonalTeamID,
		CorrelationId:  moltnetapi.NewOptUUID(uuid.MustParse(corr)),
	})
	if err != nil {
		t.Fatalf("list tasks by correlation: %v", err)
	}
	list, ok := listed.(*moltnetapi.TaskListResponse)
	if !ok {
		t.Fatalf("list tasks unexpected type: %T", listed)
	}
	if len(list.Items) != 1 {
		t.Errorf("list by correlation returned %d items, want 1", len(list.Items))
	}
}

// TestE2E_CLI_TaskCreate_DryRunDoesNotPersist proves --dry-run prints the
// canonical body without enqueuing anything.
func TestE2E_CLI_TaskCreate_DryRunDoesNotPersist(t *testing.T) {
	h := newTaskCreateHarness(t)
	corr := uuid.NewString()
	stdout, _ := h.runWithStdin(t, fulfillBriefInput(corr),
		"task", "create",
		"--task-type", "fulfill_brief",
		"--team-id", e2ePersonalTeamID.String(),
		"--diary-id", e2eDiaryID.String(),
		"--title", "E2E task create smoke",
		"--correlation-id", corr,
		"--dry-run",
	)

	// Stdout should be valid pretty JSON with the correlation id embedded.
	var body map[string]any
	decodeJSON(t, stdout, &body)
	if body["taskType"] != "fulfill_brief" {
		t.Errorf("dry-run body taskType = %v, want fulfill_brief", body["taskType"])
	}
	if body["correlationId"] != corr {
		t.Errorf("dry-run body correlationId = %v, want %s", body["correlationId"], corr)
	}
	if body["title"] != "E2E task create smoke" {
		t.Errorf("dry-run body title = %v, want E2E task create smoke", body["title"])
	}

	// Nothing should have been persisted.
	listed, err := e2eClient.ListTasks(context.Background(), moltnetapi.ListTasksParams{
		XMoltnetTeamID: e2ePersonalTeamID,
		CorrelationId:  moltnetapi.NewOptUUID(uuid.MustParse(corr)),
	})
	if err != nil {
		t.Fatalf("list tasks: %v", err)
	}
	list := listed.(*moltnetapi.TaskListResponse)
	if len(list.Items) != 0 {
		t.Errorf("dry-run created %d tasks, want 0", len(list.Items))
	}
}

// TestE2E_CLI_TaskCreate_SchemaFailureShortCircuits feeds malformed input
// and asserts the CLI exits non-zero BEFORE reaching the server. Proof: no
// row appears with the test's unique correlation id.
func TestE2E_CLI_TaskCreate_SchemaFailureShortCircuits(t *testing.T) {
	h := newTaskCreateHarness(t)
	corr := uuid.NewString()

	// Empty input — missing required `brief`.
	_, stderr := h.runExpectingFailure(t, `{}`,
		"task", "create",
		"--task-type", "fulfill_brief",
		"--team-id", e2ePersonalTeamID.String(),
		"--diary-id", e2eDiaryID.String(),
		"--correlation-id", corr,
	)
	if !strings.Contains(stderr, "input validation failed") {
		t.Errorf("expected validation failure message, got:\n%s", stderr)
	}
	if !strings.Contains(stderr, "brief") {
		t.Errorf("expected /brief in error path, got:\n%s", stderr)
	}

	listed, err := e2eClient.ListTasks(context.Background(), moltnetapi.ListTasksParams{
		XMoltnetTeamID: e2ePersonalTeamID,
		CorrelationId:  moltnetapi.NewOptUUID(uuid.MustParse(corr)),
	})
	if err != nil {
		t.Fatalf("list tasks: %v", err)
	}
	list := listed.(*moltnetapi.TaskListResponse)
	if len(list.Items) != 0 {
		t.Errorf("schema-failed create reached the server: %d row(s)", len(list.Items))
	}
}

// TestE2E_CLI_TaskCreate_SkipValidationReachesServer pairs with the test
// above: same malformed input, but --skip-validation must let the request
// through. The server then rejects it with a 4xx, surfacing as a non-zero
// exit; the key assertion is that the failure mode is API-level, not
// CLI-level.
func TestE2E_CLI_TaskCreate_SkipValidationReachesServer(t *testing.T) {
	h := newTaskCreateHarness(t)
	corr := uuid.NewString()

	_, stderr := h.runExpectingFailure(t, `{}`,
		"task", "create",
		"--task-type", "fulfill_brief",
		"--team-id", e2ePersonalTeamID.String(),
		"--diary-id", e2eDiaryID.String(),
		"--correlation-id", corr,
		"--skip-validation",
	)
	// Definitive negative: this must NOT be the CLI's own validator firing.
	if strings.Contains(stderr, "input validation failed for taskType=") {
		t.Errorf("--skip-validation still ran client-side validator:\n%s", stderr)
	}
	// The server's ProblemDetails came through — that's the proof the request
	// actually reached the API rather than dying client-side. Match on the
	// HTTP envelope the api-client prints for 4xx responses.
	if !strings.Contains(stderr, "API error (HTTP 4") {
		t.Errorf("expected server-side 4xx envelope, got:\n%s", stderr)
	}
}

// TestE2E_CLI_TaskCreate_OutputIDFormat asserts --output id prints just
// the UUID + newline, suitable for $(…) capture.
func TestE2E_CLI_TaskCreate_OutputIDFormat(t *testing.T) {
	h := newTaskCreateHarness(t)
	corr := uuid.NewString()
	stdout, _ := h.runWithStdin(t, fulfillBriefInput(corr),
		"task", "create",
		"--task-type", "fulfill_brief",
		"--team-id", e2ePersonalTeamID.String(),
		"--diary-id", e2eDiaryID.String(),
		"--title", "E2E task create smoke",
		"--correlation-id", corr,
		"--output", "id",
	)

	got := strings.TrimSpace(stdout)
	if _, err := uuid.Parse(got); err != nil {
		t.Fatalf("--output id stdout is not a UUID: %q (%v)", got, err)
	}
	// Newline + UUID and nothing else (32 hex + 4 dashes = 36).
	if len(stdout) != 36+1 { // +1 for trailing newline
		t.Errorf("--output id stdout has unexpected length=%d: %q", len(stdout), stdout)
	}
}

// TestE2E_CLI_TaskCreate_MultipleReferences asserts the wire request
// carries all references the operator passed, in order, with both the
// taskId branch and the external branch covered.
func TestE2E_CLI_TaskCreate_MultipleReferences(t *testing.T) {
	h := newTaskCreateHarness(t)
	corr := uuid.NewString()

	// Build a placeholder taskId — we don't need the referenced task to
	// exist for this assertion; we only care that the wire body round-trips
	// through the CLI. The server does NOT enforce TaskRef.taskId existence
	// for non-judged_work roles.
	placeholder := uuid.NewString()

	ref0 := fmt.Sprintf(`{"taskId":%q,"role":"context","outputCid":"bafy-A"}`, placeholder)
	ref1 := `{"taskId":null,"role":"context","outputCid":"gh:issue:42","external":{"kind":"github_issue","issue":42}}`

	stdout, _ := h.runWithStdin(t, fulfillBriefInput(corr),
		"task", "create",
		"--task-type", "fulfill_brief",
		"--team-id", e2ePersonalTeamID.String(),
		"--diary-id", e2eDiaryID.String(),
		"--title", "E2E task create smoke",
		"--correlation-id", corr,
		"--reference", ref0,
		"--reference", ref1,
	)

	var task moltnetapi.Task
	decodeJSON(t, stdout, &task)
	if len(task.References) != 2 {
		t.Fatalf("expected 2 references on persisted task, got %d", len(task.References))
	}
	// References field on Task is []TaskReferencesItem — different shape
	// than CreateTaskReq.TaskRef but carries the same role/outputCid pair.
	// Marshal to JSON and look for the GitHub issue marker as a smoke test.
	raw, _ := json.Marshal(task.References)
	if !strings.Contains(string(raw), "github_issue") {
		t.Errorf("expected github_issue in references payload, got %s", raw)
	}
}

func mapKeys(m map[string]any) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	return out
}
