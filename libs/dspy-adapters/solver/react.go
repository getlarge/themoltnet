package solver

import (
	"context"

	"github.com/XiaoConstantine/dspy-go/pkg/core"
	"github.com/XiaoConstantine/dspy-go/pkg/modules"
)

// TraceProvider is the optional interface a solver Module can implement
// to expose the ReAct tool-call trace after Process completes.
// Callers type-assert Module to TraceProvider — this keeps the Module
// interface minimal for ChainOfThought (which has no trace).
type TraceProvider interface {
	LastTraces() []*modules.ReActTrace
}

// reactModule wraps dspy-go's *modules.ReAct, delegates Process to
// ProcessWithTrace, and stashes the returned ReActTrace so the runner
// can extract it via the TraceProvider interface.
//
// lastTraces is a slice (not a single pointer) because the ReAct loop
// may be called multiple times in retry paths — each call appends.
type reactModule struct {
	inner      *modules.ReAct
	lastTraces []*modules.ReActTrace
}

func (r *reactModule) Process(ctx context.Context, inputs map[string]any, opts ...core.Option) (map[string]any, error) {
	outputs, trace, err := r.inner.ProcessWithTrace(ctx, inputs, opts...)
	if trace != nil {
		r.lastTraces = append(r.lastTraces, trace)
	}
	return outputs, err
}

func (r *reactModule) LastTraces() []*modules.ReActTrace {
	return r.lastTraces
}
