package dspyadapters

import (
	"context"
	"testing"

	"github.com/XiaoConstantine/dspy-go/pkg/core"
)

type mockInterceptableModule struct {
	interceptors []core.ModuleInterceptor
}

func (m *mockInterceptableModule) GetInterceptors() []core.ModuleInterceptor {
	copied := make([]core.ModuleInterceptor, len(m.interceptors))
	copy(copied, m.interceptors)
	return copied
}

func (m *mockInterceptableModule) SetInterceptors(interceptors []core.ModuleInterceptor) {
	m.interceptors = append([]core.ModuleInterceptor(nil), interceptors...)
}

func TestWithExecutionStateAddsStateWhenMissing(t *testing.T) {
	t.Parallel()

	ctx := WithExecutionState(context.Background())
	if core.GetExecutionState(ctx) == nil {
		t.Fatal("expected execution state on context")
	}
}

func TestWithExecutionStatePreservesExistingState(t *testing.T) {
	t.Parallel()

	ctx := core.WithExecutionState(context.Background())
	state := core.GetExecutionState(ctx)
	wrapped := WithExecutionState(ctx)
	if core.GetExecutionState(wrapped) != state {
		t.Fatal("expected existing execution state to be preserved")
	}
}

func TestApplyDefaultJudgeModuleInterceptorsPreservesExistingInterceptors(t *testing.T) {
	t.Parallel()

	existing := []core.ModuleInterceptor{
		func(ctx context.Context, inputs map[string]any, info *core.ModuleInfo, handler core.ModuleHandler, opts ...core.Option) (map[string]any, error) {
			return handler(ctx, inputs, opts...)
		},
	}
	module := &mockInterceptableModule{interceptors: existing}

	if err := ApplyDefaultJudgeModuleInterceptors(module); err != nil {
		t.Fatalf("apply default interceptors: %v", err)
	}

	after := module.GetInterceptors()
	if len(after) <= len(existing) {
		t.Fatalf("expected interceptor count to grow, before=%d after=%d", len(existing), len(after))
	}
}
