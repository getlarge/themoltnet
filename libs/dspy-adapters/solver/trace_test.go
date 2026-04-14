package solver

import (
	"encoding/json"
	"fmt"
	"testing"
	"time"

	"github.com/XiaoConstantine/dspy-go/pkg/modules"
)

func TestSerializeTrace_NilTrace(t *testing.T) {
	result, err := SerializeTrace(nil)
	if err != nil {
		t.Fatalf("SerializeTrace: %v", err)
	}
	if result != "[]" {
		t.Errorf("expected empty array for nil, got %q", result)
	}
}

func TestSerializeTrace_EmptyTrace(t *testing.T) {
	result, err := SerializeTrace(&modules.ReActTrace{})
	if err != nil {
		t.Fatalf("SerializeTrace: %v", err)
	}
	if result != "[]" {
		t.Errorf("expected empty array, got %q", result)
	}
}

func TestSerializeTrace_SingleStep(t *testing.T) {
	trace := &modules.ReActTrace{
		Steps: []modules.ReActTraceStep{
			{
				Index:       0,
				Thought:     "I need to run go generate",
				Tool:        "bash",
				Arguments:   map[string]interface{}{"command": "go generate ./..."},
				Observation: "wrote 3 files",
				Duration:    4500 * time.Millisecond,
				Success:     true,
			},
		},
	}

	result, err := SerializeTrace(trace)
	if err != nil {
		t.Fatalf("SerializeTrace: %v", err)
	}

	var spans []map[string]interface{}
	if err := json.Unmarshal([]byte(result), &spans); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if len(spans) != 1 {
		t.Fatalf("expected 1 span, got %d", len(spans))
	}

	span := spans[0]
	if span["gen_ai.operation.name"] != "execute_tool" {
		t.Errorf("operation.name: got %v", span["gen_ai.operation.name"])
	}
	if span["gen_ai.tool.name"] != "bash" {
		t.Errorf("tool.name: got %v", span["gen_ai.tool.name"])
	}
	if span["gen_ai.tool.call.id"] != "step-0" {
		t.Errorf("tool.call.id: got %v", span["gen_ai.tool.call.id"])
	}
	if span["gen_ai.tool.type"] != "function" {
		t.Errorf("tool.type: got %v", span["gen_ai.tool.type"])
	}
	if span["thought"] != "I need to run go generate" {
		t.Errorf("thought: got %v", span["thought"])
	}
	if span["gen_ai.tool.call.result"] != "wrote 3 files" {
		t.Errorf("tool.call.result: got %v", span["gen_ai.tool.call.result"])
	}
	if span["success"] != true {
		t.Errorf("success: got %v", span["success"])
	}
	if dur, ok := span["duration_ms"].(float64); !ok || dur != 4500 {
		t.Errorf("duration_ms: got %v", span["duration_ms"])
	}

	argsStr, ok := span["gen_ai.tool.call.arguments"].(string)
	if !ok {
		t.Fatalf("arguments not a string: %T", span["gen_ai.tool.call.arguments"])
	}
	var args map[string]interface{}
	if err := json.Unmarshal([]byte(argsStr), &args); err != nil {
		t.Fatalf("arguments not valid JSON: %v", err)
	}
	if args["command"] != "go generate ./..." {
		t.Errorf("arguments.command: got %v", args["command"])
	}
}

func TestSerializeTrace_ErrorStep(t *testing.T) {
	trace := &modules.ReActTrace{
		Steps: []modules.ReActTraceStep{
			{
				Index:       0,
				Tool:        "bash",
				Arguments:   map[string]interface{}{"command": "false"},
				Observation: "exit code 1",
				Duration:    100 * time.Millisecond,
				Success:     false,
				Error:       "command failed",
			},
		},
	}

	result, err := SerializeTrace(trace)
	if err != nil {
		t.Fatalf("SerializeTrace: %v", err)
	}

	var spans []map[string]interface{}
	if err := json.Unmarshal([]byte(result), &spans); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	span := spans[0]
	if span["success"] != false {
		t.Errorf("success: got %v, want false", span["success"])
	}
	if span["error.type"] != "command failed" {
		t.Errorf("error.type: got %v", span["error.type"])
	}
}

func TestSerializeTrace_MultipleSteps(t *testing.T) {
	trace := &modules.ReActTrace{
		Steps: []modules.ReActTraceStep{
			{Index: 0, Tool: "bash", Success: true, Duration: time.Second},
			{Index: 1, Tool: "read", Success: true, Duration: 500 * time.Millisecond},
			{Index: 2, Tool: "edit", Success: true, Duration: 200 * time.Millisecond},
		},
	}

	result, err := SerializeTrace(trace)
	if err != nil {
		t.Fatalf("SerializeTrace: %v", err)
	}

	var spans []map[string]interface{}
	if err := json.Unmarshal([]byte(result), &spans); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if len(spans) != 3 {
		t.Fatalf("expected 3 spans, got %d", len(spans))
	}
	for i, span := range spans {
		wantID := fmt.Sprintf("step-%d", i)
		if span["gen_ai.tool.call.id"] != wantID {
			t.Errorf("span[%d] id: got %v, want %v", i, span["gen_ai.tool.call.id"], wantID)
		}
	}
}

func TestSerializeTrace_NilArguments(t *testing.T) {
	trace := &modules.ReActTrace{
		Steps: []modules.ReActTraceStep{
			{Index: 0, Tool: "bash", Arguments: nil, Success: true, Duration: time.Second},
		},
	}

	result, err := SerializeTrace(trace)
	if err != nil {
		t.Fatalf("SerializeTrace: %v", err)
	}

	var spans []map[string]interface{}
	if err := json.Unmarshal([]byte(result), &spans); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if spans[0]["gen_ai.tool.call.arguments"] != "{}" {
		t.Errorf("expected empty JSON object for nil arguments, got %v", spans[0]["gen_ai.tool.call.arguments"])
	}
}
