// Package dspyadapters provides LLM provider initialization and common DSPy runtime helpers.
package dspyadapters

import (
	"context"
	"fmt"
	"sync"
	"time"

	"github.com/XiaoConstantine/dspy-go/pkg/config"
	"github.com/XiaoConstantine/dspy-go/pkg/core"
)

// InterceptableModule is the subset of dspy-go module behavior needed to install interceptors.
type InterceptableModule interface {
	GetInterceptors() []core.ModuleInterceptor
	SetInterceptors([]core.ModuleInterceptor)
}

var (
	defaultModuleInterceptorsOnce sync.Once
	defaultModuleInterceptors     []core.ModuleInterceptor
	defaultModuleInterceptorsErr  error
)

// WithExecutionState ensures the context carries DSPy execution state so
// tracing, metrics, and model-context decorators have somewhere to record data.
func WithExecutionState(ctx context.Context) context.Context {
	if core.GetExecutionState(ctx) != nil {
		return ctx
	}
	return core.WithExecutionState(ctx)
}

// DefaultJudgeInterceptorsConfig returns the interceptor policy used for judge
// modules in MoltNet. It enables tracing, metrics, timeout, retry, and circuit
// breaker behavior without adding caching or security policy that could distort
// judge behavior.
func DefaultJudgeInterceptorsConfig() *config.InterceptorsConfig {
	return &config.InterceptorsConfig{
		Global: config.GlobalInterceptorConfig{
			Enabled:        true,
			DefaultTimeout: 90 * time.Second,
		},
		Module: config.ModuleInterceptorsConfig{
			Metrics: config.InterceptorToggle{Enabled: true},
			Tracing: config.InterceptorToggle{Enabled: true},
			Timeout: config.TimeoutInterceptorConfig{
				Enabled: true,
				Timeout: 90 * time.Second,
			},
			CircuitBreaker: config.CircuitBreakerInterceptorConfig{
				Enabled:          true,
				FailureThreshold: 5,
				RecoveryTimeout:  30 * time.Second,
				HalfOpenRequests: 3,
			},
			Retry: config.RetryInterceptorConfig{
				Enabled:        true,
				MaxRetries:     2,
				InitialBackoff: 250 * time.Millisecond,
				MaxBackoff:     2 * time.Second,
				BackoffFactor:  2,
			},
		},
	}
}

// DefaultJudgeModuleInterceptors returns the shared module interceptors for
// MoltNet judge modules. The interceptors are built once so stateful
// interceptors like circuit breakers can accumulate across calls.
func DefaultJudgeModuleInterceptors() ([]core.ModuleInterceptor, error) {
	defaultModuleInterceptorsOnce.Do(func() {
		builder := config.NewInterceptorBuilder(DefaultJudgeInterceptorsConfig())
		defaultModuleInterceptors, defaultModuleInterceptorsErr = builder.BuildModuleInterceptors()
	})
	if defaultModuleInterceptorsErr != nil {
		return nil, defaultModuleInterceptorsErr
	}

	copied := make([]core.ModuleInterceptor, len(defaultModuleInterceptors))
	copy(copied, defaultModuleInterceptors)
	return copied, nil
}

// ApplyDefaultJudgeModuleInterceptors prepends MoltNet's default judge
// interceptors to any interceptors already configured on the module, preserving
// structured-output interceptors already installed by dspy-go helpers.
func ApplyDefaultJudgeModuleInterceptors(module InterceptableModule) error {
	defaults, err := DefaultJudgeModuleInterceptors()
	if err != nil {
		return fmt.Errorf("build default judge interceptors: %w", err)
	}

	existing := module.GetInterceptors()
	combined := make([]core.ModuleInterceptor, 0, len(defaults)+len(existing))
	combined = append(combined, defaults...)
	combined = append(combined, existing...)
	module.SetInterceptors(combined)
	return nil
}
