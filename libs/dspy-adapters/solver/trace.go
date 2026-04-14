package solver

import (
	"encoding/json"
	"fmt"

	"github.com/XiaoConstantine/dspy-go/pkg/modules"
)

// otelToolSpan maps a ReActTraceStep to the OpenTelemetry Semantic
// Conventions for GenAI execute_tool spans.
//
// See https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-spans/
//
// The "thought" field is a MoltNet extension (ReAct-specific reasoning
// before each action). When #392 lands real OTel span emission this
// struct can be emitted span-for-span with minimal mapping.
type otelToolSpan struct {
	OperationName string `json:"gen_ai.operation.name"`
	ToolName      string `json:"gen_ai.tool.name"`
	CallID        string `json:"gen_ai.tool.call.id"`
	Arguments     string `json:"gen_ai.tool.call.arguments"`
	Result        string `json:"gen_ai.tool.call.result"`
	ToolType      string `json:"gen_ai.tool.type"`
	Thought       string `json:"thought"`
	DurationMs    int64  `json:"duration_ms"`
	Success       bool   `json:"success"`
	ErrorType     string `json:"error.type"`
}

// SerializeTrace converts a ReActTrace into a JSON array string in the
// OTel gen_ai execute_tool span shape. Returns "[]" for nil or empty
// traces so callers always get valid JSON.
func SerializeTrace(trace *modules.ReActTrace) (string, error) {
	if trace == nil || len(trace.Steps) == 0 {
		return "[]", nil
	}

	spans := make([]otelToolSpan, len(trace.Steps))
	for i, step := range trace.Steps {
		args := "{}"
		if step.Arguments != nil {
			argsBytes, err := json.Marshal(step.Arguments)
			if err != nil {
				return "", fmt.Errorf("serializing step %d arguments: %w", i, err)
			}
			args = string(argsBytes)
		}

		spans[i] = otelToolSpan{
			OperationName: "execute_tool",
			ToolName:      step.Tool,
			CallID:        fmt.Sprintf("step-%d", step.Index),
			Arguments:     args,
			Result:        step.Observation,
			ToolType:      "function",
			Thought:       step.Thought,
			DurationMs:    step.Duration.Milliseconds(),
			Success:       step.Success,
			ErrorType:     step.Error,
		}
	}

	data, err := json.Marshal(spans)
	if err != nil {
		return "", fmt.Errorf("serializing trace: %w", err)
	}
	return string(data), nil
}
