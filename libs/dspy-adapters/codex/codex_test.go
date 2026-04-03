package codex

import (
	"encoding/json"
	"os"
	"strings"
	"testing"
)

func TestBuildArgs(t *testing.T) {
	t.Parallel()

	llm := &LLM{
		config: Config{Model: "o3", SandboxMode: "read-only"},
	}

	args := llm.buildArgs([]string{"--json"})

	expectInArgs := map[string]string{
		"--model":   "o3",
		"--sandbox": "read-only",
		"--json":    "",
	}
	for flag, val := range expectInArgs {
		found := false
		for i, a := range args {
			if a == flag {
				if val == "" || (i+1 < len(args) && args[i+1] == val) {
					found = true
				}
				break
			}
		}
		if !found {
			t.Errorf("expected %s %s in args, got: %v", flag, val, args)
		}
	}

	// Must start with "exec"
	if args[0] != "exec" {
		t.Errorf("first arg should be 'exec', got: %s", args[0])
	}
}

func TestExtractStructuredOutputFromJSONL(t *testing.T) {
	t.Parallel()

	jsonl := `{"type":"thread.started","thread_id":"abc-123"}
{"type":"turn.started"}
{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"{\"coverage\":\"0.85\",\"grounding\":\"0.90\",\"faithfulness\":\"0.75\",\"reasoning\":\"Good coverage.\"}"}}
{"type":"turn.completed","usage":{"input_tokens":100,"output_tokens":50}}`

	result, err := extractStructuredOutputFromJSONL(jsonl)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if result["coverage"] != "0.85" {
		t.Errorf("expected coverage=0.85, got %v", result["coverage"])
	}
	if result["grounding"] != "0.90" {
		t.Errorf("expected grounding=0.90, got %v", result["grounding"])
	}
	if result["faithfulness"] != "0.75" {
		t.Errorf("expected faithfulness=0.75, got %v", result["faithfulness"])
	}
	if result["reasoning"] != "Good coverage." {
		t.Errorf("expected reasoning='Good coverage.', got %v", result["reasoning"])
	}
}

func TestExtractStructuredOutputFromJSONL_Error(t *testing.T) {
	t.Parallel()

	jsonl := `{"type":"thread.started","thread_id":"abc-123"}
{"type":"turn.started"}
{"type":"error","message":"model not supported"}
{"type":"turn.failed","error":{"message":"model not supported"}}`

	_, err := extractStructuredOutputFromJSONL(jsonl)
	if err == nil {
		t.Fatal("expected error")
	}
	if !contains(err.Error(), "model not supported") {
		t.Errorf("expected error to contain 'model not supported', got: %v", err)
	}
}

func TestExtractStructuredOutputFromJSONL_NoAgentMessage(t *testing.T) {
	t.Parallel()

	jsonl := `{"type":"thread.started","thread_id":"abc-123"}
{"type":"turn.started"}
{"type":"turn.completed","usage":{}}`

	_, err := extractStructuredOutputFromJSONL(jsonl)
	if err == nil {
		t.Fatal("expected error")
	}
	if !contains(err.Error(), "no agent_message") {
		t.Errorf("expected 'no agent_message' error, got: %v", err)
	}
}

func TestExtractStructuredOutputFromJSONL_MultipleMessages(t *testing.T) {
	t.Parallel()

	// Should take the last agent_message
	jsonl := `{"type":"item.completed","item":{"type":"agent_message","text":"{\"answer\":\"first\"}"}}
{"type":"item.completed","item":{"type":"agent_message","text":"{\"answer\":\"second\"}"}}`

	result, err := extractStructuredOutputFromJSONL(jsonl)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result["answer"] != "second" {
		t.Errorf("expected last message, got: %v", result["answer"])
	}
}

func TestExtractJSONSchemaFromPrompt(t *testing.T) {
	t.Parallel()

	prompt := "## Output\n```json\n{\n  \"coverage\": <string>,\n  \"grounding\": <string>\n}\n```\n"

	schema := extractJSONSchemaFromPrompt(prompt)
	if schema == "" {
		t.Fatal("expected non-empty schema")
	}

	var parsed map[string]any
	if err := json.Unmarshal([]byte(schema), &parsed); err != nil {
		t.Fatalf("schema is not valid JSON: %v", err)
	}

	props, ok := parsed["properties"].(map[string]any)
	if !ok {
		t.Fatal("missing properties")
	}
	for _, field := range []string{"coverage", "grounding"} {
		if _, ok := props[field]; !ok {
			t.Errorf("missing field %q", field)
		}
	}

	// Must have additionalProperties: false for Codex
	if ap, ok := parsed["additionalProperties"]; !ok || ap != false {
		t.Error("expected additionalProperties: false")
	}
}

func TestWriteSchemaToTempFile_EnforcesAdditionalProperties(t *testing.T) {
	t.Parallel()

	// Schema without additionalProperties
	schema := `{"type":"object","properties":{"a":{"type":"string"}},"required":["a"]}`

	path, err := writeSchemaToTempFile(schema)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	defer func() {
		if path != "" {
			_ = removeFile(path)
		}
	}()

	data, err := readFile(path)
	if err != nil {
		t.Fatalf("read temp file: %v", err)
	}

	var parsed map[string]any
	if err := json.Unmarshal(data, &parsed); err != nil {
		t.Fatalf("invalid JSON: %v", err)
	}

	if ap, ok := parsed["additionalProperties"]; !ok || ap != false {
		t.Errorf("expected additionalProperties: false, got: %v", parsed["additionalProperties"])
	}
}

func contains(s, substr string) bool {
	return strings.Contains(s, substr)
}

func readFile(path string) ([]byte, error) {
	return os.ReadFile(path)
}

func removeFile(path string) error {
	return os.Remove(path)
}
