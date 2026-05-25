// normalize-spec converts TypeBox-style OpenAPI 3.1 patterns to forms that
// ogen can handle:
//
//  1. Enum flattening: TypeBox generates string enums as
//     {anyOf: [{type: string, enum: ["a"]}, {type: string, enum: ["b"]}]}
//     and this tool converts them to {type: string, enum: ["a", "b"]}.
//
//  2. Discriminated unions: anyOf where each variant is an object with a shared
//     string literal property (for example "kind" or "op") is converted to
//     oneOf with a discriminator. ogen supports oneOf+discriminator but not
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

	// Replace inline property schemas that would cause ogen type-name conflicts.
	// ogen names inline properties as <ParentSchema><TitleCase(propName)>, so
	// Task.status → TaskStatus conflicts with the TaskStatus component schema.
	// We only replace cases where the property name matches that exact pattern.
	deduplicateConflictingInlineSchemas(normalized)

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

// deduplicateConflictingInlineSchemas replaces inline property schemas that
// would cause ogen type-name conflicts. ogen names an inline property schema
// as <ParentSchemaName><TitleCase(propertyName)>, so Task.status becomes
// "TaskStatus" — conflicting with the existing TaskStatus component schema.
//
// We only replace when the component schema name equals exactly
// <parentName><titleCase(propName)> AND the inline schema is structurally
// identical to the named component schema. This avoids the over-broad
// replacement that broke unrelated types like CreateDiaryReqVisibility.
func deduplicateConflictingInlineSchemas(spec any) {
	root, ok := spec.(map[string]any)
	if !ok {
		return
	}
	components, ok := root["components"].(map[string]any)
	if !ok {
		return
	}
	schemas, ok := components["schemas"].(map[string]any)
	if !ok {
		return
	}

	// Build canonical JSON for each named schema.
	canonicals := make(map[string]string, len(schemas))
	for name, schema := range schemas {
		b, err := json.Marshal(schema)
		if err == nil {
			canonicals[name] = string(b)
		}
	}

	// Walk only the named component schemas, replacing conflicting inline
	// property schemas with $refs. Don't touch paths or other sections.
	for parentName, schema := range schemas {
		m, ok := schema.(map[string]any)
		if !ok {
			continue
		}
		props, ok := m["properties"].(map[string]any)
		if !ok {
			continue
		}
		changed := false
		for propName, propSchema := range props {
			propMap, ok := propSchema.(map[string]any)
			if !ok {
				continue
			}
			if _, isRef := propMap["$ref"]; isRef {
				continue
			}
			// Compute the ogen-generated name for this inline property.
			expectedName := parentName + titleCase(propName)
			canonical, exists := canonicals[expectedName]
			if !exists {
				continue
			}
			b, err := json.Marshal(propMap)
			if err != nil || string(b) != canonical {
				continue
			}
			// Replace the inline schema with a $ref.
			props[propName] = map[string]any{"$ref": "#/components/schemas/" + expectedName}
			changed = true
		}
		if changed {
			m["properties"] = props
			schemas[parentName] = m
		}
	}
}

// titleCase converts a snake_case or camelCase property name to TitleCase,
// matching ogen's naming convention for inline property schemas.
// e.g. "status" → "Status", "task_type" → "TaskType", "outputKind" → "OutputKind"
func titleCase(s string) string {
	if s == "" {
		return s
	}
	var result strings.Builder
	upper := true
	for _, r := range s {
		if r == '_' || r == '-' {
			upper = true
			continue
		}
		if upper {
			result.WriteRune([]rune(strings.ToUpper(string(r)))[0])
			upper = false
		} else {
			result.WriteRune(r)
		}
	}
	return result.String()
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

	// Walk repeatedly until no new schemas are added: extracting a top-level
	// variant can expose a nested discriminated union that itself needs
	// extraction (e.g. ProvenanceGraphPackNode → meta.creator → AgentPrincipal).
	for {
		before := len(schemas)
		walkExtractOneOf(root, schemas)
		// Also walk newly extracted schemas to catch nested discriminated unions.
		for _, s := range schemas {
			walkExtractOneOf(s, schemas)
		}
		if len(schemas) == before {
			break
		}
	}
}

// walkExtractOneOf recursively finds oneOf+discriminator and extracts inline schemas.
//
// Schema name derivation:
//   - For each variant, the discriminator value (e.g. `kind: "agent"`) is
//     used to derive the component schema name.
//   - If a `title` is set on the variant we use it directly (best-effort
//     human-friendly name set by the author of the schema).
//   - Otherwise we look at the variant's required properties to guess: if
//     it has fields like `humanId` we name it `Human<Capitalize(kind)>`,
//     `agentId`/`identityId+fingerprint` -> `Agent<Capitalize(kind)>`, and
//     for the original ProvenanceGraph node case we keep the historical
//     `ProvenanceGraph<Capitalize(kind)>Node` naming.
//
// The mapping field is always populated so ogen can emit a sum type.
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
					schemaName := deriveDiscriminatedSchemaName(
						member,
						propName,
						kindVal,
					)
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

// deriveDiscriminatedSchemaName picks a stable component name for an inline
// variant of a oneOf+discriminator. The heuristics check the variant's
// required-property set to distinguish the two oneOf families we currently
// have (provenance graph nodes vs principal identity) without requiring a
// schema title.
func deriveDiscriminatedSchemaName(variant map[string]any, propName string, kindVal string) string {
	props, _ := variant["properties"].(map[string]any)
	required, _ := variant["required"].([]any)
	requiredSet := make(map[string]bool, len(required))
	for _, r := range required {
		if name, ok := r.(string); ok {
			requiredSet[name] = true
		}
	}
	hasProp := func(name string) bool {
		if _, ok := props[name]; ok {
			return true
		}
		return requiredSet[name]
	}

	// Principal-identity family: { kind, identityId, fingerprint, publicKey }
	// (agent) or { kind, humanId, identityId } (human).
	if hasProp("fingerprint") && hasProp("publicKey") {
		return capitalize(kindVal) + "Principal"
	}
	if hasProp("humanId") {
		return capitalize(kindVal) + "Principal"
	}

	// Claim-condition family: { op: "all"|"any", conditions } or
	// { op: "task_status"|"task_accepted", taskId, ... }.
	if propName == "op" && (hasProp("conditions") || hasProp("taskId")) {
		return "ClaimCondition" + titleCase(kindVal)
	}

	// Default — historical provenance graph node naming (pack/entry/rendered_pack).
	return fmt.Sprintf("ProvenanceGraph%sNode", capitalize(kindVal))
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
// object with the same string literal discriminator property.
// It converts:
//
//	{anyOf: [{..., op: {enum:["a"]}}, {..., op: {enum:["b"]}}]}
//
// to:
//
//	{oneOf: [...], discriminator: {propertyName: "op"}}
//
// The variants are recursively normalized before being placed in oneOf.
func tryConvertDiscriminatedUnion(obj map[string]any) (map[string]any, bool) {
	// Allow obj to carry `anyOf` plus an allowlist of harmless siblings:
	// `discriminator` (TypeBox Type.Union with { discriminator: { propertyName } })
	// and `nullable` (left over from a prior tryConvertNullable pass on
	// Type.Optional(Type.Union([...]))). Anything else means the schema has
	// additional constraints and we can't safely convert.
	for k := range obj {
		switch k {
		case "anyOf", "discriminator", "nullable":
		default:
			return nil, false
		}
	}
	members, ok := obj["anyOf"].([]any)
	if !ok || len(members) < 2 {
		return nil, false
	}

	propName, ok := inferDiscriminatorProperty(members)
	if !ok {
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
		kindProp, ok := props[propName].(map[string]any)
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

	out := map[string]any{
		"oneOf": normalized,
		"discriminator": map[string]any{
			"propertyName": propName,
		},
	}
	if nullable, ok := obj["nullable"]; ok {
		out["nullable"] = nullable
	}
	return out, true
}

func inferDiscriminatorProperty(members []any) (string, bool) {
	var common map[string]bool
	for _, m := range members {
		member, ok := m.(map[string]any)
		if !ok || member["type"] != "object" {
			return "", false
		}
		props, ok := member["properties"].(map[string]any)
		if !ok {
			return "", false
		}
		literalProps := make(map[string]bool)
		for name, raw := range props {
			prop, ok := raw.(map[string]any)
			if !ok {
				continue
			}
			if prop["type"] != "string" {
				continue
			}
			enum, ok := prop["enum"].([]any)
			if !ok || len(enum) != 1 {
				continue
			}
			if _, ok := enum[0].(string); ok {
				literalProps[name] = true
			}
		}
		if common == nil {
			common = literalProps
			continue
		}
		for name := range common {
			if !literalProps[name] {
				delete(common, name)
			}
		}
	}
	if len(common) == 0 {
		return "", false
	}
	if common["kind"] {
		return "kind", true
	}
	if common["op"] {
		return "op", true
	}
	names := make([]string, 0, len(common))
	for name := range common {
		names = append(names, name)
	}
	sort.Strings(names)
	return names[0], true
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
