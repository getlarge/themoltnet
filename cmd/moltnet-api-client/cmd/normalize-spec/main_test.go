package main

import (
	"encoding/json"
	"testing"
)

func TestTryConvertEnum_BasicPattern(t *testing.T) {
	input := map[string]any{
		"anyOf": []any{
			map[string]any{"type": "string", "enum": []any{"a"}},
			map[string]any{"type": "string", "enum": []any{"b"}},
		},
	}
	result, ok := tryConvertEnum(input)
	if !ok {
		t.Fatal("expected conversion")
	}
	if result["type"] != "string" {
		t.Errorf("expected type string, got %v", result["type"])
	}
	enum := result["enum"].([]any)
	if len(enum) != 2 || enum[0] != "a" || enum[1] != "b" {
		t.Errorf("expected [a, b], got %v", enum)
	}
}

func TestTryConvertEnum_PreservesDescription(t *testing.T) {
	input := map[string]any{
		"description": "Entry memory type",
		"anyOf": []any{
			map[string]any{"type": "string", "enum": []any{"episodic"}},
			map[string]any{"type": "string", "enum": []any{"semantic"}},
		},
	}
	result, ok := tryConvertEnum(input)
	if !ok {
		t.Fatal("expected conversion")
	}
	if result["description"] != "Entry memory type" {
		t.Errorf("expected description preserved, got %v", result["description"])
	}
	if result["type"] != "string" {
		t.Errorf("expected type string, got %v", result["type"])
	}
}

func TestTryConvertEnum_RejectsNonEnumAnyOf(t *testing.T) {
	input := map[string]any{
		"anyOf": []any{
			map[string]any{"type": "object", "properties": map[string]any{}},
			map[string]any{"type": "null"},
		},
	}
	_, ok := tryConvertEnum(input)
	if ok {
		t.Fatal("should not convert non-enum anyOf")
	}
}

func TestTryConvertDiscriminatedUnion(t *testing.T) {
	input := map[string]any{
		"anyOf": []any{
			map[string]any{
				"type": "object",
				"properties": map[string]any{
					"kind": map[string]any{"type": "string", "enum": []any{"pack"}},
					"id":   map[string]any{"type": "string"},
				},
			},
			map[string]any{
				"type": "object",
				"properties": map[string]any{
					"kind": map[string]any{"type": "string", "enum": []any{"entry"}},
					"id":   map[string]any{"type": "string"},
				},
			},
		},
	}
	result, ok := tryConvertDiscriminatedUnion(input)
	if !ok {
		t.Fatal("expected conversion")
	}
	if _, hasOneOf := result["oneOf"]; !hasOneOf {
		t.Fatal("expected oneOf key")
	}
	if _, hasAnyOf := result["anyOf"]; hasAnyOf {
		t.Fatal("anyOf should be removed")
	}
	disc := result["discriminator"].(map[string]any)
	if disc["propertyName"] != "kind" {
		t.Errorf("expected discriminator on kind, got %v", disc["propertyName"])
	}
}

func TestTryConvertDiscriminatedUnion_RejectsNonKindObjects(t *testing.T) {
	input := map[string]any{
		"anyOf": []any{
			map[string]any{
				"type":       "object",
				"properties": map[string]any{"name": map[string]any{"type": "string"}},
			},
			map[string]any{
				"type":       "object",
				"properties": map[string]any{"name": map[string]any{"type": "string"}},
			},
		},
	}
	_, ok := tryConvertDiscriminatedUnion(input)
	if ok {
		t.Fatal("should not convert objects without kind discriminator")
	}
}

func TestTryConvertNullable(t *testing.T) {
	input := map[string]any{
		"anyOf": []any{
			map[string]any{"type": "string"},
			map[string]any{"type": "null"},
		},
	}
	result, ok := tryConvertNullable(input)
	if !ok {
		t.Fatal("expected conversion")
	}
	if result["type"] != "string" {
		t.Errorf("expected type string, got %v", result["type"])
	}
	if result["nullable"] != true {
		t.Errorf("expected nullable true, got %v", result["nullable"])
	}
}

func TestTryConvertNullable_ObjectWithNull(t *testing.T) {
	input := map[string]any{
		"anyOf": []any{
			map[string]any{
				"type":       "object",
				"properties": map[string]any{"id": map[string]any{"type": "string"}},
				"required":   []any{"id"},
			},
			map[string]any{"type": "null"},
		},
	}
	result, ok := tryConvertNullable(input)
	if !ok {
		t.Fatal("expected conversion")
	}
	if result["type"] != "object" {
		t.Errorf("expected type object, got %v", result["type"])
	}
	if result["nullable"] != true {
		t.Errorf("expected nullable true")
	}
	if result["properties"] == nil {
		t.Error("expected properties preserved")
	}
}

func TestTryConvertNullable_RejectsThreeVariants(t *testing.T) {
	input := map[string]any{
		"anyOf": []any{
			map[string]any{"type": "string"},
			map[string]any{"type": "number"},
			map[string]any{"type": "null"},
		},
	}
	_, ok := tryConvertNullable(input)
	if ok {
		t.Fatal("should not convert 3-variant anyOf as nullable")
	}
}

func TestTryConvertMultiTypeAdditionalProps(t *testing.T) {
	input := map[string]any{
		"type": "object",
		"additionalProperties": map[string]any{
			"anyOf": []any{
				map[string]any{"type": "string"},
				map[string]any{"type": "number"},
				map[string]any{"type": "boolean"},
				map[string]any{"type": "null"},
			},
		},
	}
	result, ok := tryConvertMultiTypeAdditionalProps(input)
	if !ok {
		t.Fatal("expected conversion")
	}
	addl := result["additionalProperties"].(map[string]any)
	if len(addl) != 0 {
		t.Errorf("expected empty additionalProperties, got %v", addl)
	}
}

func TestNormalize_FullProvenanceGraph(t *testing.T) {
	// Simplified provenance graph schema matching the real pattern.
	input := `{
		"anyOf": [
			{
				"type": "object",
				"properties": {
					"kind": {"type": "string", "enum": ["pack"]},
					"cid": {"anyOf": [{"type": "string"}, {"type": "null"}]},
					"meta": {
						"type": "object",
						"additionalProperties": {
							"anyOf": [
								{"type": "string"},
								{"type": "number"},
								{"type": "boolean"},
								{"type": "null"}
							]
						}
					}
				}
			},
			{
				"type": "object",
				"properties": {
					"kind": {"type": "string", "enum": ["entry"]},
					"cid": {"anyOf": [{"type": "string"}, {"type": "null"}]},
					"meta": {
						"type": "object",
						"properties": {
							"entryType": {
								"description": "Entry type",
								"anyOf": [
									{"type": "string", "enum": ["episodic"]},
									{"type": "string", "enum": ["semantic"]}
								]
							}
						}
					}
				}
			}
		]
	}`

	var parsed any
	if err := json.Unmarshal([]byte(input), &parsed); err != nil {
		t.Fatal(err)
	}

	result := normalize(parsed)
	m := result.(map[string]any)

	// Should be converted to oneOf + discriminator.
	if _, ok := m["oneOf"]; !ok {
		t.Fatal("expected oneOf")
	}
	if _, ok := m["anyOf"]; ok {
		t.Fatal("anyOf should be gone")
	}

	// Variants should have nullable cid, simplified additionalProperties,
	// and flattened entryType enum.
	variants := m["oneOf"].([]any)
	if len(variants) != 2 {
		t.Fatalf("expected 2 variants, got %d", len(variants))
	}

	// Check entry variant has flattened entryType enum.
	entry := variants[1].(map[string]any)
	entryMeta := entry["properties"].(map[string]any)["meta"].(map[string]any)
	entryProps := entryMeta["properties"].(map[string]any)
	entryType := entryProps["entryType"].(map[string]any)
	if entryType["type"] != "string" {
		t.Errorf("expected entryType.type=string, got %v", entryType["type"])
	}
	enum := entryType["enum"].([]any)
	if len(enum) != 2 {
		t.Errorf("expected 2 enum values, got %d", len(enum))
	}
	if entryType["description"] != "Entry type" {
		t.Errorf("expected description preserved, got %v", entryType["description"])
	}
}
