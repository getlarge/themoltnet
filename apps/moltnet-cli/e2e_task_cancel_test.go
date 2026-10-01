//go:build e2e

package main

import (
	"context"
	"testing"

	moltnetapi "github.com/getlarge/themoltnet/libs/moltnet-api-client"
	"github.com/google/uuid"
)

func TestE2E_CLI_TaskCancel(t *testing.T) {
	h := newTaskCreateHarness(t)
	stdout, _ := h.runWithStdin(t, fulfillBriefInput(uuid.NewString()),
		"task", "create",
		"--task-type", "fulfill_brief",
		"--team-id", e2ePersonalTeamID.String(),
		"--diary-id", e2eDiaryID.String(),
	)
	var created moltnetapi.Task
	decodeJSON(t, stdout, &created)

	const reason = "CLI e2e task no longer needed"
	stdout, _ = h.run(t,
		"task", "cancel", created.ID.String(),
		"--team-id", e2ePersonalTeamID.String(),
		"--reason", reason,
	)
	var cancelled moltnetapi.Task
	decodeJSON(t, stdout, &cancelled)
	if cancelled.ID != created.ID || cancelled.Status != moltnetapi.TaskStatusCancelled {
		t.Fatalf("cancel result = (%s, %s), want (%s, cancelled)", cancelled.ID, cancelled.Status, created.ID)
	}
	if got := cancelled.CancelReason.Value; got != reason {
		t.Fatalf("cancel reason = %q, want %q", got, reason)
	}

	res, err := e2eClient.GetTask(context.Background(), moltnetapi.GetTaskParams{
		ID:             created.ID,
		XMoltnetTeamID: moltnetapi.NewOptUUID(e2ePersonalTeamID),
	})
	if err != nil {
		t.Fatalf("get cancelled task: %v", err)
	}
	persisted, ok := res.(*moltnetapi.Task)
	if !ok {
		t.Fatalf("get cancelled task returned %T", res)
	}
	if persisted.Status != moltnetapi.TaskStatusCancelled || persisted.CancelReason.Value != reason {
		t.Fatalf("persisted status/reason = (%s, %q)", persisted.Status, persisted.CancelReason.Value)
	}
}
