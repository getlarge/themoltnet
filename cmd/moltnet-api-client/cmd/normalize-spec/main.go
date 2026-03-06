// normalize-spec converts TypeBox-style OpenAPI 3.1 anyOf enum patterns to
// standard OpenAPI enum arrays for ogen compatibility.
//
// TypeBox generates string enums as:
//
//	anyOf: [{type: string, enum: ["a"]}, {type: string, enum: ["b"]}]
//
// This tool converts them to:
//
//	type: string
//	enum: ["a", "b"]
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

// normalize walks the JSON tree and converts TypeBox anyOf enum patterns to
// standard {type: string, enum: [...]} schemas.
func normalize(v any) any {
	switch val := v.(type) {
	case map[string]any:
		if converted, ok := tryConvertEnum(val); ok {
			return converted
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

// tryConvertEnum detects the TypeBox anyOf enum pattern:
//
//	{anyOf: [{type: "string", enum: ["a"]}, {type: "string", enum: ["b"]}, ...]}
//
// and returns the normalized form {type: "string", enum: ["a", "b", ...]}.
func tryConvertEnum(obj map[string]any) (map[string]any, bool) {
	if len(obj) != 1 {
		return nil, false
	}
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

	return map[string]any{"type": "string", "enum": values}, true
}
