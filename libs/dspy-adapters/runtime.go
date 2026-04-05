// Package dspyadapters provides LLM provider initialization and common DSPy runtime helpers.
package dspyadapters

import (
	"context"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/XiaoConstantine/dspy-go/pkg/config"
	"github.com/XiaoConstantine/dspy-go/pkg/core"
	dspyerrors "github.com/XiaoConstantine/dspy-go/pkg/errors"
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

// RunJudgeStructured executes a structured judge call using an explicit LLM
// instance, bypassing dspy-go's global default LLM.
//
// dspy-go's WithStructuredOutput() interceptor hardcodes
// core.GlobalConfig.DefaultLLM, making it unsuitable for concurrent execution.
// This function replicates the same behavior (build CoT prompt → call
// GenerateWithJSON → parse result) with a caller-supplied LLM.
func RunJudgeStructured(ctx context.Context, llm core.LLM, sig core.Signature, inputs map[string]any) (map[string]any, error) {
	ctx = WithExecutionState(ctx)
	prompt := buildCoTPrompt(sig, inputs)

	cfg := DefaultJudgeInterceptorsConfig()
	timeout := cfg.Module.Timeout.Timeout
	maxRetries := cfg.Module.Retry.MaxRetries
	backoff := cfg.Module.Retry.InitialBackoff
	backoffFactor := cfg.Module.Retry.BackoffFactor
	maxBackoff := cfg.Module.Retry.MaxBackoff

	var result map[string]any
	var lastErr error
	for attempt := 0; attempt <= maxRetries; attempt++ {
		callCtx, cancel := context.WithTimeout(ctx, timeout)
		result, lastErr = llm.GenerateWithJSON(callCtx, prompt)
		cancel()
		if lastErr == nil {
			return result, nil
		}
		if attempt < maxRetries {
			time.Sleep(backoff)
			backoff = time.Duration(float64(backoff) * float64(backoffFactor))
			if backoff > maxBackoff {
				backoff = maxBackoff
			}
		}
	}
	return nil, dspyerrors.WithFields(
		dspyerrors.Wrap(lastErr, dspyerrors.LLMGenerationFailed, "structured judge call failed"),
		dspyerrors.Fields{"model": llm.ModelID(), "attempts": maxRetries + 1},
	)
}

// buildCoTPrompt builds a chain-of-thought structured prompt from a signature
// and inputs, matching the format that dspy-go's interceptor produces.
func buildCoTPrompt(sig core.Signature, inputs map[string]any) string {
	var sb strings.Builder

	if sig.Instruction != "" {
		sb.WriteString(sig.Instruction)
		sb.WriteString("\n\n")
	}

	sb.WriteString("## Inputs\n")
	for _, f := range sig.Inputs {
		if v, ok := inputs[f.Name]; ok {
			sb.WriteString(fmt.Sprintf("**%s**: %v\n", f.Name, v))
		}
	}
	sb.WriteString("\n")

	sb.WriteString("## Instructions\n")
	sb.WriteString("Think through this step-by-step. First explain your reasoning, then provide the answer.\n\n")

	sb.WriteString("## Required Output Format\n")
	sb.WriteString("Respond with a JSON object in this exact format:\n\n")
	sb.WriteString("```json\n{\n")
	sb.WriteString("  \"reasoning\": \"<your step-by-step reasoning>\",\n")

	nonReasoning := make([]core.OutputField, 0, len(sig.Outputs))
	for _, f := range sig.Outputs {
		if f.Name != "reasoning" {
			nonReasoning = append(nonReasoning, f)
		}
	}
	for i, f := range nonReasoning {
		sb.WriteString(fmt.Sprintf("  \"%s\": <string>", f.Name))
		if i < len(nonReasoning)-1 {
			sb.WriteString(",")
		}
		sb.WriteString("\n")
	}
	sb.WriteString("}\n```\n\n")

	sb.WriteString("### Field Descriptions\n")
	sb.WriteString("- **reasoning**: Your detailed step-by-step reasoning process\n")
	for _, f := range sig.Outputs {
		if f.Name != "reasoning" && f.Description != "" {
			sb.WriteString(fmt.Sprintf("- **%s**: %s\n", f.Name, f.Description))
		}
	}
	sb.WriteString("\nRespond ONLY with the JSON object, no additional text.")

	return sb.String()
}
