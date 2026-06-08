package main

import (
	"encoding/json"
	"reflect"
	"testing"
)

func TestMarshalMoltnetConfigSchema_MatchesEmbedded(t *testing.T) {
	generated, err := marshalMoltnetConfigSchema()
	if err != nil {
		t.Fatalf("marshalMoltnetConfigSchema: %v", err)
	}

	var generatedSchema map[string]any
	if err := json.Unmarshal(generated, &generatedSchema); err != nil {
		t.Fatalf("json.Unmarshal(generated): %v", err)
	}

	var embeddedSchema map[string]any
	if err := json.Unmarshal(embeddedMoltnetConfigSchema, &embeddedSchema); err != nil {
		t.Fatalf("json.Unmarshal(embedded): %v", err)
	}

	if !reflect.DeepEqual(generatedSchema, embeddedSchema) {
		t.Fatalf("embedded schema is out of date; regenerate apps/moltnet-cli/schema/moltnet-config.v1.json")
	}
}

func TestMarshalMoltnetConfigSchema_IncludesSchemaField(t *testing.T) {
	generated, err := marshalMoltnetConfigSchema()
	if err != nil {
		t.Fatalf("marshalMoltnetConfigSchema: %v", err)
	}

	var schema map[string]any
	if err := json.Unmarshal(generated, &schema); err != nil {
		t.Fatalf("json.Unmarshal: %v", err)
	}

	if schema["$id"] != moltnetConfigSchemaURL {
		t.Fatalf("$id = %v, want %q", schema["$id"], moltnetConfigSchemaURL)
	}

	properties, ok := schema["properties"].(map[string]any)
	if !ok {
		t.Fatal("schema.properties missing or invalid")
	}
	if _, ok := properties["$schema"]; !ok {
		t.Fatal("schema missing $schema property")
	}
}
