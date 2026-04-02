package claudecode

import (
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
