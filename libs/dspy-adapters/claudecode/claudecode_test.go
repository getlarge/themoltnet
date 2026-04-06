package claudecode

import (
	"encoding/json"
	"testing"

	"github.com/XiaoConstantine/dspy-go/pkg/core"
)

func TestBuildJSONArgsUsesJSONOutputFormat(t *testing.T) {
	t.Parallel()

	llm := &LLM{
		BaseLLM: core.NewBaseLLM(ProviderName, core.ModelID(DefaultModel), nil, nil),
		config:  Config{Model: DefaultModel},
	}

	args := llm.buildJSONArgs(nil)
	found := false
	for i := 0; i < len(args)-1; i++ {
		if args[i] == "--output-format" && args[i+1] == "json" {
			found = true
			break
		}
	}

	if !found {
		t.Fatalf("expected --output-format json in args, got: %v", args)
	}
}

func TestExtractJSONSchemaFromPrompt(t *testing.T) {
	t.Parallel()

	prompt := `## Instructions
Think through this step-by-step.

## Required Output Format
Respond with a JSON object in this exact format:

` + "```json" + `
{
  "reasoning": "<your step-by-step reasoning>",
  "coverage": <string>,
  "grounding": <string>,
  "faithfulness": <string>
}
` + "```" + `

### Field Descriptions
- **reasoning**: Your detailed step-by-step reasoning process
`

	schema := extractJSONSchemaFromPrompt(prompt)
	if schema == "" {
		t.Fatal("expected non-empty schema")
	}

	var parsed map[string]any
	if err := json.Unmarshal([]byte(schema), &parsed); err != nil {
		t.Fatalf("schema is not valid JSON: %v\nschema: %s", err, schema)
	}

	props, ok := parsed["properties"].(map[string]any)
	if !ok {
		t.Fatal("missing properties in schema")
	}

	for _, field := range []string{"reasoning", "coverage", "grounding", "faithfulness"} {
		if _, ok := props[field]; !ok {
			t.Errorf("missing field %q in schema properties", field)
		}
	}

	required, ok := parsed["required"].([]any)
	if !ok {
		t.Fatal("missing required array in schema")
	}
	if len(required) != 4 {
		t.Errorf("expected 4 required fields, got %d", len(required))
	}
}

func TestParseJSONResponse_UnwrapsEnvelope(t *testing.T) {
	t.Parallel()

	envelope := `{
		"type": "result",
		"subtype": "success",
		"result": "",
		"structured_output": {
			"coverage": "0.85",
			"grounding": "0.90",
			"faithfulness": "0.75",
			"reasoning": "Good coverage overall."
		}
	}`

	result, err := parseJSONResponse(envelope)
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
}

func TestParseJSONResponse_PlainJSON(t *testing.T) {
	t.Parallel()

	plain := `{"coverage": "0.85", "grounding": "0.90"}`
	result, err := parseJSONResponse(plain)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result["coverage"] != "0.85" {
		t.Errorf("expected coverage=0.85, got %v", result["coverage"])
	}
}

func TestParseJSONResponse_InvalidJSON(t *testing.T) {
	t.Parallel()

	_, err := parseJSONResponse("not json at all")
	if err == nil {
		t.Fatal("expected error for invalid JSON")
	}
}

func TestExtractJSONSchemaFromPromptNoFence(t *testing.T) {
	t.Parallel()

	schema := extractJSONSchemaFromPrompt("no json fence here")
	if schema != "" {
		t.Fatalf("expected empty schema, got: %s", schema)
	}
}

func TestParseStreamJSONExtractsTrajectoryAndUsage(t *testing.T) {
	t.Parallel()
	input := []byte(`{"type":"system","subtype":"init","session_id":"abc"}
{"type":"assistant","message":{"content":[{"type":"text","text":"Hello"}]}}
{"type":"result","subtype":"success","session_id":"sess-1","result":"Hello!","duration_ms":1234,"total_cost_usd":0.05,"num_turns":1,"usage":{"input_tokens":100,"output_tokens":50,"cache_read_input_tokens":10}}
`)
	r := parseStreamJSON(input)
	if len(r.Trajectory) != 2 {
		t.Fatalf("expected 2 trajectory events (assistant+result), got %d", len(r.Trajectory))
	}
	if r.Content != "Hello!" {
		t.Fatalf("expected 'Hello!', got %q", r.Content)
	}
	if r.SessionID != "sess-1" {
		t.Fatalf("expected session ID 'sess-1', got %q", r.SessionID)
	}
	if r.DurationMs != 1234 {
		t.Fatalf("expected duration 1234, got %d", r.DurationMs)
	}
	if r.CostUSD != 0.05 {
		t.Fatalf("expected cost 0.05, got %f", r.CostUSD)
	}
	if r.NumTurns != 1 {
		t.Fatalf("expected 1 turn, got %d", r.NumTurns)
	}
	if r.Usage == nil {
		t.Fatal("expected non-nil usage")
	}
	if r.Usage.PromptTokens != 100 {
		t.Fatalf("expected 100 prompt tokens, got %d", r.Usage.PromptTokens)
	}
	if r.Usage.CompletionTokens != 50 {
		t.Fatalf("expected 50 completion tokens, got %d", r.Usage.CompletionTokens)
	}
}

func TestParseStreamJSONHandlesEmptyInput(t *testing.T) {
	t.Parallel()
	r := parseStreamJSON([]byte{})
	if len(r.Trajectory) != 0 {
		t.Fatal("expected empty trajectory")
	}
	if r.Content != "" {
		t.Fatal("expected empty content")
	}
}

func TestLastUsageReturnsNilByDefault(t *testing.T) {
	t.Parallel()
	cfg := Config{Model: "test"}
	llm := &LLM{
		BaseLLM: core.NewBaseLLM(ProviderName, "test", nil, nil),
		config:  cfg,
	}
	if llm.LastUsage() != nil {
		t.Fatal("expected nil LastUsage by default")
	}
}
