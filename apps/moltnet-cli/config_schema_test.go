package main

import (
	"bytes"
	"encoding/json"
	"testing"
)

func TestRunConfigSchemaCmd(t *testing.T) {
	t.Parallel()

	var out bytes.Buffer
	if err := runConfigSchemaCmd(&out); err != nil {
		t.Fatalf("runConfigSchemaCmd: %v", err)
	}

	var schema map[string]any
	if err := json.Unmarshal(out.Bytes(), &schema); err != nil {
		t.Fatalf("schema output should be valid JSON: %v", err)
	}

	if schema["$id"] != MoltnetConfigSchemaURL {
		t.Fatalf("$id: got %v, want %s", schema["$id"], MoltnetConfigSchemaURL)
	}

	properties, ok := schema["properties"].(map[string]any)
	if !ok {
		t.Fatalf("properties missing or wrong type: %T", schema["properties"])
	}
	if _, ok := properties["identity_id"]; !ok {
		t.Fatal("identity_id property missing")
	}
	if _, ok := properties["$schema"]; !ok {
		t.Fatal("$schema property missing")
	}
}

func TestEmbeddedSchemaMatchesGeneratedSchema(t *testing.T) {
	t.Parallel()

	var embeddedOut bytes.Buffer
	if err := runConfigSchemaCmd(&embeddedOut); err != nil {
		t.Fatalf("runConfigSchemaCmd: %v", err)
	}

	generated, err := generateCredentialsSchemaJSON()
	if err != nil {
		t.Fatalf("generateCredentialsSchemaJSON: %v", err)
	}

	embeddedCanonical := canonicalizeJSON(t, embeddedOut.Bytes())
	generatedCanonical := canonicalizeJSON(t, generated)
	if !bytes.Equal(embeddedCanonical, generatedCanonical) {
		t.Fatal("embedded schema is out of sync with generated schema")
	}
}

func canonicalizeJSON(t *testing.T, data []byte) []byte {
	t.Helper()
	var v any
	if err := json.Unmarshal(data, &v); err != nil {
		t.Fatalf("json unmarshal: %v", err)
	}
	canonical, err := json.Marshal(v)
	if err != nil {
		t.Fatalf("json marshal: %v", err)
	}
	return canonical
}
