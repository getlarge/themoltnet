package main

import (
	"compress/flate"
	"encoding/base64"
	"io"
	"strings"
	"testing"
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
