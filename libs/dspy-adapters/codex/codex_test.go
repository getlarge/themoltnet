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

func TestParseCodexTrajectoryExtractsUsageAndSessionID(t *testing.T) {
	t.Parallel()
	input := []byte(`{"type":"thread.started","thread_id":"tid-123"}
{"type":"item.completed","item":{"type":"agent_message","text":"I created the file."}}
{"type":"turn.completed","usage":{"input_tokens":100,"cached_input_tokens":20,"output_tokens":50}}
{"type":"item.completed","item":{"type":"agent_message","text":"Done."}}
{"type":"turn.completed","usage":{"input_tokens":80,"cached_input_tokens":10,"output_tokens":30}}
`)
	r := parseCodexTrajectory(input)
	if r.SessionID != "tid-123" {
		t.Fatalf("expected session ID 'tid-123', got %q", r.SessionID)
	}
	if r.Content != "Done." {
		t.Fatalf("expected 'Done.', got %q", r.Content)
	}
	if r.NumTurns != 2 {
		t.Fatalf("expected 2 turns, got %d", r.NumTurns)
	}
	if r.Usage == nil {
		t.Fatal("expected non-nil usage")
	}
	if r.Usage.PromptTokens != 180 {
		t.Fatalf("expected 180 prompt tokens, got %d", r.Usage.PromptTokens)
	}
	if r.Usage.CompletionTokens != 80 {
		t.Fatalf("expected 80 completion tokens, got %d", r.Usage.CompletionTokens)
	}
	// 5 trajectory events: thread.started + 2x item.completed + 2x turn.completed
	if len(r.Trajectory) != 5 {
		t.Fatalf("expected 5 trajectory events, got %d", len(r.Trajectory))
	}
}

func TestParseCodexTrajectoryHandlesErrors(t *testing.T) {
	t.Parallel()
	input := []byte(`{"type":"error","message":"rate limit exceeded"}
{"type":"turn.failed","error":{"message":"API error"}}
`)
	r := parseCodexTrajectory(input)
	if r.Content != "API error" {
		t.Fatalf("expected 'API error', got %q", r.Content)
	}
	if r.NumTurns != 0 {
		t.Fatalf("expected 0 turns, got %d", r.NumTurns)
	}
}

func TestParseCodexTrajectoryHandlesEmptyInput(t *testing.T) {
	t.Parallel()
	r := parseCodexTrajectory([]byte{})
	if len(r.Trajectory) != 0 {
		t.Fatal("expected empty trajectory")
	}
	if r.Content != "" {
		t.Fatal("expected empty content")
	}
}

func TestBridgeCodexAuthCopiesExistingFile(t *testing.T) {
	srcDir := t.TempDir()
	authContent := `{"OPENAI_API_KEY":"sk-from-file"}`
	if err := os.WriteFile(srcDir+"/auth.json", []byte(authContent), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("CODEX_HOME", srcDir)
	t.Setenv("MOLTNET_CODEX_AUTH_CACHE_PATH", "")
	t.Setenv("OPENAI_API_KEY", "")

	isolatedHome := t.TempDir()
	if err := BridgeCodexAuth(isolatedHome); err != nil {
		t.Fatalf("BridgeCodexAuth: %v", err)
	}

	got, err := os.ReadFile(isolatedHome + "/auth.json")
	if err != nil {
		t.Fatalf("auth.json not written: %v", err)
	}
	if string(got) != authContent {
		t.Fatalf("expected %q, got %q", authContent, string(got))
	}
}

func TestBridgeCodexAuthFallsBackToAPIKey(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	t.Setenv("CODEX_HOME", t.TempDir())
	t.Setenv("MOLTNET_CODEX_AUTH_CACHE_PATH", "")
	t.Setenv("OPENAI_API_KEY", "sk-test-key")

	isolatedHome := t.TempDir()
	if err := BridgeCodexAuth(isolatedHome); err != nil {
		t.Fatalf("BridgeCodexAuth: %v", err)
	}

	got, err := os.ReadFile(isolatedHome + "/auth.json")
	if err != nil {
		t.Fatalf("auth.json not written: %v", err)
	}
	if !strings.Contains(string(got), "sk-test-key") {
		t.Fatalf("expected API key in auth.json, got %q", string(got))
	}
}

func TestBridgeCodexAuthNoCredsIsNotError(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	t.Setenv("CODEX_HOME", t.TempDir())
	t.Setenv("MOLTNET_CODEX_AUTH_CACHE_PATH", "")
	t.Setenv("OPENAI_API_KEY", "")

	isolatedHome := t.TempDir()
	if err := BridgeCodexAuth(isolatedHome); err != nil {
		t.Fatalf("expected nil error, got %v", err)
	}
	if _, err := os.Stat(isolatedHome + "/auth.json"); !os.IsNotExist(err) {
		t.Fatal("expected no auth.json when no credentials available")
	}
}

func TestBuildArgsRespectsWorkDir(t *testing.T) {
	t.Parallel()
	llm := &LLM{config: Config{Model: "test", SandboxMode: "read-only"}}
	args := llm.buildArgs(nil)
	// Default: should have --cd
	hasCD := false
	for _, a := range args {
		if a == "--cd" {
			hasCD = true
		}
	}
	if !hasCD {
		t.Fatal("expected --cd flag when WorkDir is empty")
	}

	// With WorkDir: should NOT have --cd
	llm2 := &LLM{config: Config{Model: "test", SandboxMode: "read-only", WorkDir: "/tmp/work"}}
	args2 := llm2.buildArgs(nil)
	for _, a := range args2 {
		if a == "--cd" {
			t.Fatal("should not have --cd flag when WorkDir is set")
		}
	}
}
