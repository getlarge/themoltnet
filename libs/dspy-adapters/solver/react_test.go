package solver

import (
	"testing"

	"github.com/XiaoConstantine/dspy-go/pkg/modules"
	"github.com/XiaoConstantine/dspy-go/pkg/tools"
)

func TestReactModuleImplementsModule(t *testing.T) {
	registry := tools.NewInMemoryToolRegistry()
	react := modules.NewReAct(VivoSignature(), registry, 5)
	react.SetLLM(&stubLLM{})

	rm := &reactModule{inner: react}

	// Verify it satisfies Module interface
	var _ Module = rm
}

func TestReactModuleImplementsTraceProvider(t *testing.T) {
	registry := tools.NewInMemoryToolRegistry()
	react := modules.NewReAct(VivoSignature(), registry, 5)
	react.SetLLM(&stubLLM{})

	rm := &reactModule{inner: react}

	// Verify it satisfies TraceProvider interface
	var _ TraceProvider = rm
}

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
