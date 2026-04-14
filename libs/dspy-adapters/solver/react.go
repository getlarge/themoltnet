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

// LastTraces returns a shallow copy of the captured traces so callers
// can't mutate internal state. The *modules.ReActTrace values themselves
// are shared — treat them as read-only.
func (r *reactModule) LastTraces() []*modules.ReActTrace {
	if r.lastTraces == nil {
		return nil
	}
	out := make([]*modules.ReActTrace, len(r.lastTraces))
	copy(out, r.lastTraces)
	return out
}

// Compile-time assertions: reactModule must satisfy Module and TraceProvider.
var (
	_ Module        = (*reactModule)(nil)
	_ TraceProvider = (*reactModule)(nil)
)
