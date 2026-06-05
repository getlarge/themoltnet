//go:build e2e

package main

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/google/uuid"
)

// E2E for `moltnet task continue` against the live rest-api from the
// e2e compose stack. Each test creates a real freeform source task,
// then exercises the continuation CLI via --dry-run so the test
// asserts the constructed CreateTaskReq matches the spec without
// requiring daemonState plumbing on the parent (Task 12's stamp
// requires a daemon-completed attempt, which the harness can't easily
// simulate from a CLI test).
//
// The dry-run path still exercises every load-bearing part of the
// CLI's composition: source fetch, taskType check, claim-condition
// injection, executor inheritance, continueFrom packing, and the
// flag-shape contract. The server-side validator path (covered by
// rest-api e2e in #1287) is the load-bearing test for the daemonState
// gate — we don't duplicate it here.

// freeformInputJSON returns a minimal valid freeform input. The
// correlation id is embedded in the brief so the seeded task is easy
// to find via tasks list.
func freeformInputJSON(corrID string) string {
	return `{
  "brief": "E2E source for task continue — correlation ` + corrID + `"
}`
}

// TestE2E_CLI_TaskContinue_DryRunFromQueuedSource creates a freeform
// task, runs `task continue --dry-run` against it, and asserts the
// printed CreateTaskReq has the expected shape. --dry-run never POSTs
// the continuation, so the parent's still-queued state is fine.
func TestE2E_CLI_TaskContinue_DryRunFromQueuedSource(t *testing.T) {
	h := newTaskCreateHarness(t)
	corr := uuid.NewString()

	// 1. Seed a freeform source task.
	createOut, _ := h.runWithStdin(t, freeformInputJSON(corr),
		"task", "create",
		"--task-type", "freeform",
		"--team-id", e2ePersonalTeamID.String(),
		"--diary-id", e2eDiaryID.String(),
		"--correlation-id", corr,
		"--output", "id",
	)
	srcID := strings.TrimSpace(createOut)
	if _, err := uuid.Parse(srcID); err != nil {
		t.Fatalf("expected task create to print a UUID, got %q", srcID)
	}

	// 2. Dry-run a continuation. --skip-validation because the dry-run
	//    path still calls the live server for schema validation by
	//    default, and the test focus is the composition shape — not
	//    server-side schema introspection.
	dryOut, _ := h.runWithStdin(t, "",
		"task", "continue",
		"--from-task-id", srcID,
		"--from-attempt-n", "1",
		"--brief", "Next step: assert the chain",
		"--title", "Round 2",
		"--dry-run",
		"--skip-validation",
	)

	// 3. Decode and assert the CreateTaskReq shape.
	var req map[string]any
	decodeJSON(t, dryOut, &req)

	if req["taskType"] != "freeform" {
		t.Errorf("taskType = %v, want freeform", req["taskType"])
	}
	if req["teamId"] != e2ePersonalTeamID.String() {
		t.Errorf("teamId = %v, want %s (inherited from source)", req["teamId"], e2ePersonalTeamID)
	}
	if req["correlationId"] != corr {
		t.Errorf("correlationId = %v, want %s (inherited from source)", req["correlationId"], corr)
	}

	cc, ok := req["claimCondition"].(map[string]any)
	if !ok {
		t.Fatalf("claimCondition missing or wrong shape: %v", req["claimCondition"])
	}
	if cc["op"] != "task_status" {
		t.Errorf("claimCondition.op = %v, want task_status", cc["op"])
	}
	if cc["taskId"] != srcID {
		t.Errorf("claimCondition.taskId = %v, want %s", cc["taskId"], srcID)
	}
	statuses, _ := cc["statuses"].([]any)
	if len(statuses) != 1 || statuses[0] != "completed" {
		t.Errorf("claimCondition.statuses = %v, want [completed]", statuses)
	}

	input, ok := req["input"].(map[string]any)
	if !ok {
		t.Fatalf("input missing or wrong shape: %v", req["input"])
	}
	if input["brief"] != "Next step: assert the chain" {
		t.Errorf("input.brief = %v", input["brief"])
	}
	if input["title"] != "Round 2" {
		t.Errorf("input.title = %v", input["title"])
	}
	if _, present := input["execution"]; present {
		t.Errorf("input.execution should not be set on continuations; got %v", input["execution"])
	}
	cf, ok := input["continueFrom"].(map[string]any)
	if !ok {
		t.Fatalf("input.continueFrom missing or wrong shape: %v", input["continueFrom"])
	}
	if cf["taskId"] != srcID {
		t.Errorf("continueFrom.taskId = %v, want %s", cf["taskId"], srcID)
	}
	if cf["attemptN"].(float64) != 1 {
		t.Errorf("continueFrom.attemptN = %v, want 1", cf["attemptN"])
	}
	if _, modeSent := cf["mode"]; modeSent {
		t.Errorf("continueFrom.mode should be omitted when --mode not passed; got %v", cf["mode"])
	}
}

// TestE2E_CLI_TaskContinue_RejectsForkMode confirms the CLI rejects
// --mode fork locally without a server hop, with a message pointing at
// the follow-up issue.
func TestE2E_CLI_TaskContinue_RejectsForkMode(t *testing.T) {
	h := newTaskCreateHarness(t)
	_, stderr := h.runExpectingFailure(t, "",
		"task", "continue",
		"--from-task-id", "11111111-1111-4111-8111-111111111111",
		"--from-attempt-n", "1",
		"--brief", "fork probe",
		"--mode", "fork",
		"--dry-run",
		"--skip-validation",
	)
	if !strings.Contains(stderr, "fork") || !strings.Contains(stderr, "1293") {
		t.Errorf("stderr = %q, want substrings 'fork' and '1293'", stderr)
	}
}

// TestE2E_CLI_TaskContinue_RejectsNonFreeformSource creates a
// fulfill_brief task and asserts the continuation CLI rejects it with
// a clear error before the create hop.
func TestE2E_CLI_TaskContinue_RejectsNonFreeformSource(t *testing.T) {
	h := newTaskCreateHarness(t)
	corr := uuid.NewString()

	// Seed a fulfill_brief (non-freeform) task.
	createOut, _ := h.runWithStdin(t, fulfillBriefInput(corr),
		"task", "create",
		"--task-type", "fulfill_brief",
		"--team-id", e2ePersonalTeamID.String(),
		"--diary-id", e2eDiaryID.String(),
		"--correlation-id", corr,
		"--output", "id",
	)
	srcID := strings.TrimSpace(createOut)
	if _, err := uuid.Parse(srcID); err != nil {
		t.Fatalf("expected task create to print a UUID, got %q", srcID)
	}

	_, stderr := h.runExpectingFailure(t, "",
		"task", "continue",
		"--from-task-id", srcID,
		"--from-attempt-n", "1",
		"--brief", "Should reject",
		"--dry-run",
		"--skip-validation",
	)
	if !strings.Contains(stderr, "freeform") {
		t.Errorf("stderr = %q, want substring 'freeform'", stderr)
	}
}

// decodeJSON also lives in e2e_helpers_test.go; here we re-use it via
// the shared package scope.
var _ = json.Marshal
