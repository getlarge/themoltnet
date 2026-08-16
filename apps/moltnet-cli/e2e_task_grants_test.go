//go:build e2e

package main

import (
	"strings"
	"testing"

	moltnetapi "github.com/getlarge/themoltnet/libs/moltnet-api-client"
	"github.com/google/uuid"
)

func TestE2E_CLI_TaskGrantsLifecycleAndSanitizedError(t *testing.T) {
	h := newTaskCreateHarness(t)
	stdout, _ := h.runWithStdin(t, fulfillBriefInput(uuid.NewString()),
		"task", "create",
		"--task-type", "fulfill_brief",
		"--team-id", e2ePersonalTeamID.String(),
		"--diary-id", e2eDiaryID.String(),
	)
	var task moltnetapi.Task
	decodeJSON(t, stdout, &task)

	subjectID := uuid.New()
	grantArgs := []string{
		task.ID.String(),
		"--team-id", e2ePersonalTeamID.String(),
		"--subject-id", subjectID.String(),
		"--subject-ns", "Agent",
		"--role", "writer",
	}
	stdout, _ = h.run(t, append([]string{"task", "grants", "create"}, grantArgs...)...)
	var created map[string]any
	decodeJSON(t, stdout, &created)
	if created["subjectId"] != subjectID.String() || created["role"] != "writer" {
		t.Fatalf("unexpected created grant: %v", created)
	}

	stdout, _ = h.run(t,
		"task", "grants", "list", task.ID.String(),
		"--team-id", e2ePersonalTeamID.String(),
	)
	if !strings.Contains(stdout, subjectID.String()) {
		t.Fatalf("task grant listing omitted subject %s: %s", subjectID, stdout)
	}

	stdout, _ = h.run(t, append([]string{"task", "grants", "revoke"}, grantArgs...)...)
	var revoked struct {
		Revoked bool `json:"revoked"`
	}
	decodeJSON(t, stdout, &revoked)
	if !revoked.Revoked {
		t.Fatal("expected task grant revocation")
	}

	_, stderr, err := runE2ECLI(
		h.bin,
		h.creds,
		"task", "grants", "list", task.ID.String(),
		"--team-id", uuid.NewString(),
	)
	if err == nil {
		t.Fatal("mismatched task team unexpectedly succeeded")
	}
	if !strings.Contains(stderr, "API error (HTTP 404)") {
		t.Fatalf("expected sanitized API error, got: %s", stderr)
	}
	if strings.Contains(stderr, e2eCreds.OAuth2.ClientSecret) || strings.Contains(stderr, "Bearer ") {
		t.Fatalf("task grant error leaked credentials: %s", stderr)
	}
}
