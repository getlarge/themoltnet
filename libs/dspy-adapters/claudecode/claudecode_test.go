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

func TestExtractJSONSchemaFromPromptNoFence(t *testing.T) {
	t.Parallel()

	schema := extractJSONSchemaFromPrompt("no json fence here")
	if schema != "" {
		t.Fatalf("expected empty schema, got: %s", schema)
	}
}
