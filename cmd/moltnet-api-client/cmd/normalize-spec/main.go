// normalize-spec converts TypeBox-style OpenAPI 3.1 patterns to forms that
// ogen can handle:
//
//  1. Enum flattening: TypeBox generates string enums as
//     {anyOf: [{type: string, enum: ["a"]}, {type: string, enum: ["b"]}]}
//     and this tool converts them to {type: string, enum: ["a", "b"]}.
//
//  2. Discriminated unions: anyOf where each variant is an object with a "kind"
//     property whose enum has exactly one value is converted to oneOf with a
//     discriminator on "kind". ogen supports oneOf+discriminator but not
//     complex anyOf (see https://github.com/ogen-go/ogen/issues/491).
//
// Output JSON has object keys sorted lexicographically for deterministic diffs.
//
// Usage: normalize-spec <input.json> <output.json>
package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"sort"
	"strings"
)

func main() {
	if len(os.Args) != 3 {
		fmt.Fprintf(os.Stderr, "Usage: normalize-spec <input.json> <output.json>\n")
		os.Exit(1)
	}

	data, err := os.ReadFile(os.Args[1])
	if err != nil {
		log.Fatalf("read input: %v", err)
	}

	var spec any
	if err := json.Unmarshal(data, &spec); err != nil {
		log.Fatalf("parse JSON: %v", err)
	}

	normalized := normalize(spec)

	// Extract inline oneOf discriminated union variants into components/schemas
	// so that ogen can handle them (it requires $ref in oneOf+discriminator).
	extractDiscriminatedUnionSchemas(normalized)

	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetIndent("", "  ")
	if err := enc.Encode(sortedKeys(normalized)); err != nil {
		log.Fatalf("marshal output: %v", err)
	}

	if err := os.WriteFile(os.Args[2], buf.Bytes(), 0o644); err != nil {
		log.Fatalf("write output: %v", err)
	}
}

// extractDiscriminatedUnionSchemas walks the spec looking for oneOf+discriminator
// with inline schemas. For each match, it moves the inline schemas into
// components/schemas with generated names and replaces them with $ref entries.
// ogen requires $ref targets in oneOf+discriminator, not inline objects.
func extractDiscriminatedUnionSchemas(spec any) {
	root, ok := spec.(map[string]any)
	if !ok {
		return
	}
	components, ok := root["components"].(map[string]any)
	if !ok {
		components = map[string]any{}
		root["components"] = components
	}
	schemas, ok := components["schemas"].(map[string]any)
	if !ok {
		schemas = map[string]any{}
		components["schemas"] = schemas
	}

	walkExtractOneOf(root, schemas)
}

// walkExtractOneOf recursively finds oneOf+discriminator and extracts inline schemas.
func walkExtractOneOf(v any, schemas map[string]any) {
	switch val := v.(type) {
	case map[string]any:
		disc, hasDisc := val["discriminator"].(map[string]any)
		members, hasOneOf := val["oneOf"].([]any)
		if hasDisc && hasOneOf {
			propName, _ := disc["propertyName"].(string)
			if propName != "" {
				mapping := make(map[string]any, len(members))
				for i, m := range members {
					member, ok := m.(map[string]any)
					if !ok {
						continue
					}
					// Already a $ref — skip.
					if _, isRef := member["$ref"]; isRef {
						continue
					}
					// Derive schema name from the discriminator value.
					props, _ := member["properties"].(map[string]any)
					kindProp, _ := props[propName].(map[string]any)
					kindEnum, _ := kindProp["enum"].([]any)
					if len(kindEnum) != 1 {
						continue
					}
					kindVal, _ := kindEnum[0].(string)
					if kindVal == "" {
						continue
					}
					schemaName := fmt.Sprintf("ProvenanceGraph%sNode", capitalize(kindVal))
					schemas[schemaName] = member
					members[i] = map[string]any{
						"$ref": "#/components/schemas/" + schemaName,
					}
					mapping[kindVal] = "#/components/schemas/" + schemaName
				}
				if len(mapping) > 0 {
					disc["mapping"] = mapping
				}
			}
		}
		for _, child := range val {
			walkExtractOneOf(child, schemas)
		}
	case []any:
		for _, child := range val {
			walkExtractOneOf(child, schemas)
		}
	}
}

func capitalize(s string) string {
	if s == "" {
		return s
	}
	return strings.ToUpper(s[:1]) + s[1:]
}

// sortedMap is a JSON-marshalable map with deterministic (sorted) key order.
type sortedMap struct {
	keys []string
	vals map[string]any
}

func (m sortedMap) MarshalJSON() ([]byte, error) {
	var buf bytes.Buffer
	buf.WriteByte('{')
	for i, k := range m.keys {
		if i > 0 {
			buf.WriteByte(',')
		}
		key, err := json.Marshal(k)
		if err != nil {
			return nil, err
		}
		buf.Write(key)
		buf.WriteByte(':')
		val, err := json.Marshal(m.vals[k])
		if err != nil {
			return nil, err
		}
		buf.Write(val)
	}
	buf.WriteByte('}')
	return buf.Bytes(), nil
}

// sortedKeys converts any value so that maps marshal with sorted keys.
func sortedKeys(v any) any {
	switch val := v.(type) {
	case map[string]any:
		keys := make([]string, 0, len(val))
		for k := range val {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		vals := make(map[string]any, len(val))
		for k, child := range val {
			vals[k] = sortedKeys(child)
		}
		return sortedMap{keys: keys, vals: vals}
	case []any:
		out := make([]any, len(val))
		for i, child := range val {
			out[i] = sortedKeys(child)
		}
		return out
	default:
		return v
	}
}

// normalize walks the JSON tree and applies all conversions.
func normalize(v any) any {
	switch val := v.(type) {
	case map[string]any:
		if converted, ok := tryConvertEnum(val); ok {
			return converted
		}
		if converted, ok := tryConvertDiscriminatedUnion(val); ok {
			return converted
		}
		if converted, ok := tryConvertNullable(val); ok {
			return normalize(converted)
		}
		if converted, ok := tryConvertMultiTypeAdditionalProps(val); ok {
			return normalize(converted)
		}
		out := make(map[string]any, len(val))
		for k, child := range val {
			out[k] = normalize(child)
		}
		return out
	case []any:
		out := make([]any, len(val))
		for i, child := range val {
			out[i] = normalize(child)
		}
		return out
	default:
		return v
	}
}

// tryConvertDiscriminatedUnion detects an anyOf where every variant is an
// object with a "kind" property whose enum has exactly one literal value.
// It converts:
//
//	{anyOf: [{..., kind: {enum:["a"]}}, {..., kind: {enum:["b"]}}]}
//
// to:
//
//	{oneOf: [...], discriminator: {propertyName: "kind"}}
//
// The variants are recursively normalized before being placed in oneOf.
func tryConvertDiscriminatedUnion(obj map[string]any) (map[string]any, bool) {
	if len(obj) != 1 {
		return nil, false
	}
	members, ok := obj["anyOf"].([]any)
	if !ok || len(members) < 2 {
		return nil, false
	}

	for _, m := range members {
		member, ok := m.(map[string]any)
		if !ok {
			return nil, false
		}
		if member["type"] != "object" {
			return nil, false
		}
		props, ok := member["properties"].(map[string]any)
		if !ok {
			return nil, false
		}
		kindProp, ok := props["kind"].(map[string]any)
		if !ok {
			return nil, false
		}
		kindEnum, ok := kindProp["enum"].([]any)
		if !ok || len(kindEnum) != 1 {
			return nil, false
		}
	}

	// All variants qualify — convert to oneOf with discriminator.
	normalized := make([]any, len(members))
	for i, m := range members {
		normalized[i] = normalize(m)
	}

	return map[string]any{
		"oneOf": normalized,
		"discriminator": map[string]any{
			"propertyName": "kind",
		},
	}, true
}

// tryConvertNullable detects anyOf patterns like:
//
//	{anyOf: [{type: "string"}, {type: "null"}]}
//	{anyOf: [{type: "object", ...}, {type: "null"}]}
//
// and converts them to the non-null schema with nullable: true.
// This is the OpenAPI 3.0 nullable style that ogen handles natively.
func tryConvertNullable(obj map[string]any) (map[string]any, bool) {
	members, ok := obj["anyOf"].([]any)
	if !ok || len(members) != 2 {
		return nil, false
	}

	var nonNull map[string]any
	nullCount := 0
	for _, m := range members {
		member, ok := m.(map[string]any)
		if !ok {
			return nil, false
		}
		if member["type"] == "null" && len(member) == 1 {
			nullCount++
		} else {
			nonNull = member
		}
	}
	if nullCount != 1 || nonNull == nil {
		return nil, false
	}

	// Copy the non-null schema and add nullable: true.
	// Preserve any other keys from the parent object (e.g. description).
	out := make(map[string]any, len(obj)+len(nonNull))
	for k, v := range obj {
		if k == "anyOf" {
			continue
		}
		out[k] = v
	}
	for k, v := range nonNull {
		out[k] = v
	}
	out["nullable"] = true
	return out, true
}

// tryConvertMultiTypeAdditionalProps detects additionalProperties with a
// multi-type anyOf like {anyOf: [{type:string},{type:number},{type:boolean},{type:null}]}
// and replaces it with an empty schema (accepts any value), which ogen handles.
func tryConvertMultiTypeAdditionalProps(obj map[string]any) (map[string]any, bool) {
	if obj["type"] != "object" {
		return nil, false
	}
	addlProps, ok := obj["additionalProperties"].(map[string]any)
	if !ok {
		return nil, false
	}
	members, ok := addlProps["anyOf"].([]any)
	if !ok || len(members) < 3 {
		return nil, false
	}
	// Check all members are simple type declarations
	for _, m := range members {
		member, ok := m.(map[string]any)
		if !ok || len(member) != 1 {
			return nil, false
		}
		if _, hasType := member["type"]; !hasType {
			return nil, false
		}
	}
	out := make(map[string]any, len(obj))
	for k, v := range obj {
		if k == "additionalProperties" {
			out[k] = map[string]any{}
		} else {
			out[k] = v
		}
	}
	return out, true
}

// tryConvertEnum detects the TypeBox anyOf enum pattern:
//
//	{anyOf: [{type: "string", enum: ["a"]}, {type: "string", enum: ["b"]}, ...]}
//
// and returns the normalized form {type: "string", enum: ["a", "b", ...]}.
// Preserves sibling keys like "description" from the parent object.
func tryConvertEnum(obj map[string]any) (map[string]any, bool) {
	members, ok := obj["anyOf"].([]any)
	if !ok || len(members) < 2 {
		return nil, false
	}

	values := make([]any, 0, len(members))
	for _, m := range members {
		member, ok := m.(map[string]any)
		if !ok {
			return nil, false
		}
		if member["type"] != "string" {
			return nil, false
		}
		enum, ok := member["enum"].([]any)
		if !ok || len(enum) != 1 {
			return nil, false
		}
		values = append(values, enum[0])
	}

	out := make(map[string]any, len(obj)+1)
	for k, v := range obj {
		if k == "anyOf" {
			continue
		}
		out[k] = v
	}
	out["type"] = "string"
	out["enum"] = values
	return out, true
}
