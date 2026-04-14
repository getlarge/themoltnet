package solver

import (
	"testing"

	"github.com/XiaoConstantine/dspy-go/pkg/modules"
	"github.com/XiaoConstantine/dspy-go/pkg/tools"
)

func TestReactModuleLastTracesEmptyBeforeProcess(t *testing.T) {
	registry := tools.NewInMemoryToolRegistry()
	react := modules.NewReAct(VivoSignature(), registry, 5)
	react.SetLLM(&stubLLM{})

	rm := &reactModule{inner: react}
	traces := rm.LastTraces()
	if len(traces) != 0 {
		t.Errorf("expected empty traces before Process, got %d", len(traces))
	}
}
