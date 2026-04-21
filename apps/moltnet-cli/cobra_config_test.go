package main

import (
	"encoding/json"
	"testing"
)

func TestConfigSchemaCommand(t *testing.T) {
	t.Parallel()

	root := NewRootCmd("test", "")
	stdout, _, err := executeCommand(root, "config", "schema")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	var schema map[string]any
	if err := json.Unmarshal([]byte(stdout), &schema); err != nil {
		t.Fatalf("expected JSON output, got error: %v", err)
	}
	if schema["$id"] != MoltnetConfigSchemaURL {
		t.Fatalf("$id: got %v, want %s", schema["$id"], MoltnetConfigSchemaURL)
	}
}
