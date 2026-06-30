package main

import (
	"compress/flate"
	"encoding/base64"
	"io"
	"strings"
	"testing"

	moltnetapi "github.com/getlarge/themoltnet/libs/moltnet-api-client"
	"github.com/google/uuid"
)

func TestDeflateBase64URL(t *testing.T) {
	input := []byte(`{"metadata":{"format":"moltnet.provenance-graph/v1"},"nodes":[],"edges":[]}`)

	encoded, err := deflateBase64URL(input)
	if err != nil {
		t.Fatalf("deflateBase64URL: %v", err)
	}

	// Should be URL-safe base64 (no +, /, or = padding).
	if strings.ContainsAny(encoded, "+/=") {
		t.Errorf("encoded string contains non-URL-safe chars: %s", encoded)
	}

	// Decode and inflate to verify round-trip.
	compressed, err := base64.RawURLEncoding.DecodeString(encoded)
	if err != nil {
		t.Fatalf("base64 decode: %v", err)
	}
	reader := flate.NewReader(strings.NewReader(string(compressed)))
	defer reader.Close()
	decompressed, err := io.ReadAll(reader)
	if err != nil {
		t.Fatalf("inflate: %v", err)
	}
	if string(decompressed) != string(input) {
		t.Errorf("round-trip mismatch:\n  got:  %s\n  want: %s", decompressed, input)
	}
}

func TestRunPackProvenance_RequiresOneSelector(t *testing.T) {
	// Neither --pack-id nor --pack-cid should fail.
	err := runPackProvenance([]string{})
	if err == nil {
		t.Fatal("expected error with no selectors")
	}
	if !strings.Contains(err.Error(), "exactly one") {
		t.Errorf("unexpected error: %v", err)
	}

	// Both --pack-id and --pack-cid should fail.
	err = runPackProvenance([]string{"--pack-id", "00000000-0000-0000-0000-000000000000", "--pack-cid", "bafy123"})
	if err == nil {
		t.Fatal("expected error with both selectors")
	}
}

func TestRunPackProvenance_InvalidPackID(t *testing.T) {
	err := runPackProvenance([]string{"--pack-id", "not-a-uuid"})
	if err == nil {
		t.Fatal("expected error with invalid UUID")
	}
	if !strings.Contains(err.Error(), "invalid --pack-id") {
		t.Errorf("unexpected error: %v", err)
	}
}

func TestRunPackProvenance_NegativeDepth(t *testing.T) {
	err := runPackProvenance([]string{"--pack-id", "00000000-0000-0000-0000-000000000000", "--depth", "-1"})
	if err == nil {
		t.Fatal("expected error with negative depth")
	}
	if !strings.Contains(err.Error(), "non-negative") {
		t.Errorf("unexpected error: %v", err)
	}
}

func TestFormatInjectionConflict(t *testing.T) {
	t.Parallel()

	id1 := uuid.MustParse("11111111-1111-1111-1111-111111111111")
	id2 := uuid.MustParse("22222222-2222-2222-2222-222222222222")

	conflict := &moltnetapi.InjectionConflictProblemDetails{
		Title:  "Conflict",
		Detail: moltnetapi.NewOptString("Pack contains 2 entry(ies) flagged as prompt-injection risk; pass force: true to override."),
		Flagged: []moltnetapi.InjectionConflictProblemDetailsFlaggedItem{
			{
				ID: id1,
				Threats: []moltnetapi.InjectionConflictProblemDetailsFlaggedItemThreatsItem{
					{Type: "instruction_override", Severity: 0.9, Match: "ignore previous"},
					{Type: "role_hijack", Severity: 0.7, Match: "you are now"},
				},
			},
			// An entry flagged with no enumerated threats still gets listed.
			{ID: id2, Threats: nil},
		},
	}

	err := formatInjectionConflict(conflict)
	if err == nil {
		t.Fatal("expected a non-nil error")
	}
	msg := err.Error()

	for _, want := range []string{
		"flagged as prompt-injection risk", // the detail message
		id1.String(),
		"instruction_override, role_hijack", // threat types joined
		id2.String(),
		"Re-run with --force",
	} {
		if !strings.Contains(msg, want) {
			t.Errorf("expected message to contain %q, got:\n%s", want, msg)
		}
	}
}

// Falls back to Title when Detail is unset.
func TestFormatInjectionConflict_NoDetail(t *testing.T) {
	t.Parallel()

	conflict := &moltnetapi.InjectionConflictProblemDetails{
		Title:   "Conflict",
		Flagged: []moltnetapi.InjectionConflictProblemDetailsFlaggedItem{},
	}

	msg := formatInjectionConflict(conflict).Error()
	if !strings.Contains(msg, "Conflict") {
		t.Errorf("expected fallback to Title, got:\n%s", msg)
	}
}
