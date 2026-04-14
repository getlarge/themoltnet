// Package solver wraps dspy-go modules for MoltNet eval solvers.
//
// The solver is the component that actually *solves* an eval task — i.e.
// the agent running in the isolated worktree. This package exists so the
// runner can pick a dspy-go module (ChainOfThought, ReAct, …) via config
// without the CLI and eval.json wiring needing to know anything about
// dspy-go internals.
//
// See docs/superpowers/specs/2026-04-08-eval-solver-dspy-module.md and
// issue #714 for design context. The sibling vitro/vivo spec at
// docs/superpowers/specs/2026-04-07-eval-runner-isolation-modes-design.md
// is why solver selection exists in the first place: vitro runs prefer
// ChainOfThought, vivo runs will prefer ReAct once the tool registry
// lands (tracked as a follow-up).
package solver

import (
	"context"
	"fmt"

	"github.com/XiaoConstantine/dspy-go/pkg/core"
	"github.com/XiaoConstantine/dspy-go/pkg/modules"
	"github.com/XiaoConstantine/dspy-go/pkg/tools"
)

// Kind identifies which dspy-go module drives the solver.
type Kind string

const (
	// KindChainOfThought uses modules.ChainOfThought. Shipped today.
	// Used as the default for vitro eval scenarios (self-contained task
	// inputs, no runtime tool use driven by dspy-go).
	KindChainOfThought Kind = "cot"

	// KindReAct uses modules.ReAct with a tool registry for vivo
	// eval scenarios. Requires Config.Registry to be set.
	KindReAct Kind = "react"
)

// ParseKind parses a CLI/config string into a Kind.
// Unknown values return a descriptive error rather than silently
// defaulting — solver selection is load-bearing.
func ParseKind(s string) (Kind, error) {
	switch Kind(s) {
	case KindChainOfThought:
		return KindChainOfThought, nil
	case KindReAct:
		return KindReAct, nil
	default:
		return "", fmt.Errorf("solver: unknown kind %q (valid: %q, %q)", s, KindChainOfThought, KindReAct)
	}
}

// Config configures a new solver module instance.
//
// LLM is required. Signature is required. MaxIterations is only
// consumed by KindReAct; it is ignored for KindChainOfThought.
type Config struct {
	Kind      Kind
	Signature core.Signature
	LLM       core.LLM

	// MaxIterations caps the ReAct outer loop. Ignored for
	// KindChainOfThought. Defaults to 3 when ≤0 — eval scenarios are
	// scoped and each iteration is a full CLI subprocess round trip.
	MaxIterations int

	// Registry is the tool registry for ReAct. Required for KindReAct,
	// ignored for KindChainOfThought.
	Registry *tools.InMemoryToolRegistry
}

// Module is the narrow interface eval code actually needs. Keeping it
// smaller than the full dspy-go surface makes the package trivially
// testable with a fake LLM and keeps dspy-go internals out of eval.go.
//
// Process mirrors core.Module.Process: takes a map of named inputs
// (matching the signature's input fields) and returns a map of named
// outputs (matching the signature's output fields).
type Module interface {
	Process(ctx context.Context, inputs map[string]any, opts ...core.Option) (map[string]any, error)
}

// New constructs a dspy-go module for the given config.
//
// For KindChainOfThought, the module is a fresh *modules.ChainOfThought
// with the provided signature and LLM explicitly installed via SetLLM
// (no reliance on dspy-go's global default LLM — that matters because
// eval runs can execute in parallel with different LLMs per trial).
//
// For KindReAct, Config.Registry must be non-nil and MaxIterations
// defaults to 10 when ≤0. Returns a *reactModule that implements
// both Module and TraceProvider.
func New(cfg Config) (Module, error) {
	if cfg.LLM == nil {
		return nil, fmt.Errorf("solver: Config.LLM is required")
	}
	// Both inputs and outputs are required. A signature with only
	// inputs produces a module that parses no outputs; a signature with
	// only outputs has nothing to prompt with. Rejecting either keeps
	// the factory strict — same spirit as ParseKind.
	if len(cfg.Signature.Inputs) == 0 || len(cfg.Signature.Outputs) == 0 {
		return nil, fmt.Errorf("solver: Config.Signature must have both inputs and outputs (got %d inputs, %d outputs)", len(cfg.Signature.Inputs), len(cfg.Signature.Outputs))
	}

	switch cfg.Kind {
	case KindChainOfThought:
		cot := modules.NewChainOfThought(cfg.Signature)
		// SetLLM writes to the underlying *Predict.LLM field directly;
		// there is no global-state path involved at call time, so
		// multiple solvers with different LLMs can run concurrently.
		cot.SetLLM(cfg.LLM)
		return cot, nil
	case KindReAct:
		if cfg.Registry == nil {
			return nil, fmt.Errorf("solver: Config.Registry is required for ReAct")
		}
		// Default 3 iterations: eval scenarios are scoped and each
		// iteration is a full CLI-adapter subprocess (no prompt-cache
		// reuse across iterations), so every round adds real latency.
		// Scenarios that need more can set react.max_iterations in
		// eval.json.
		maxIters := cfg.MaxIterations
		if maxIters <= 0 {
			maxIters = 3
		}
		react := modules.NewReAct(cfg.Signature, cfg.Registry, maxIters)
		react.SetLLM(cfg.LLM)
		return &reactModule{inner: react}, nil
	default:
		return nil, fmt.Errorf("solver: unknown Kind %q", cfg.Kind)
	}
}
