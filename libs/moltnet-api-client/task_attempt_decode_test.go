package moltnetapi

import "testing"

func TestTaskAttemptDecodeAcceptsAdditiveFields(t *testing.T) {
	payload := []byte(`{
		"taskId":"11111111-1111-4111-8111-111111111111",
		"attemptN":1,
		"claimedByAgentId":"22222222-2222-4222-8222-222222222222",
		"leaseId":null,
		"runtimeProfileId":null,
		"runtimeProfileRevision":null,
		"policySnapshotHash":null,
		"runtimeId":null,
		"claimedAt":"2026-06-04T12:00:00Z",
		"startedAt":null,
		"completedAt":null,
		"status":"claimed",
		"output":null,
		"outputCid":null,
		"claimedExecutorFingerprint":null,
		"claimedExecutorManifest":null,
		"completedExecutorFingerprint":null,
		"completedExecutorManifest":null,
		"error":null,
		"usage":null,
		"contentSignature":null,
		"signedAt":null,
		"daemonState":null,
		"futureServerField":{"revision":2}
	}`)

	var attempt TaskAttempt
	if err := attempt.UnmarshalJSON(payload); err != nil {
		t.Fatalf("decode TaskAttempt with additive field: %v", err)
	}
	if attempt.AttemptN != 1 || attempt.Status != TaskAttemptStatusClaimed {
		t.Fatalf("known fields were not decoded: %+v", attempt)
	}
	if got := string(attempt.AdditionalProps["futureServerField"]); got != `{"revision":2}` {
		t.Fatalf("futureServerField = %s, want preserved raw JSON", got)
	}
}
