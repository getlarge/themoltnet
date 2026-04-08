// Package dspytypes provides shared types for dspy-go LLM adapters.
// It is a leaf package with no adapter imports, breaking import cycles.
package dspytypes

import (
	"encoding/json"
	"time"

	"github.com/XiaoConstantine/dspy-go/pkg/core"
)

// UsageTracker is implemented by LLM adapters that capture token usage
// from CLI subprocess output. Read LastUsage() after GenerateWithJSON
// to get metrics that the core.LLM interface drops.
type UsageTracker interface {
	LastUsage() *core.TokenInfo
}

// GenerateResponse extends the standard LLM response with trajectory
// and rich metadata for eval use cases.
type GenerateResponse struct {
	Content    string
	Trajectory []json.RawMessage
	SessionID  string
	DurationMs int64
	CostUSD    float64
	NumTurns   int
	Usage      *core.TokenInfo
	// Cache token fields not in core.TokenInfo.
	CacheCreationTokens int
	CacheReadTokens     int
}

// TrajectoryProvider is implemented by adapters whose Generate method
// captures the full CLI event stream (not just the final text). Callers
// can read the most recent trajectory via LastTrajectory() after any
// Generate / GenerateWithJSON call — the side-channel is populated for
// every invocation so dspy-go modules (ChainOfThought, ReAct) can drive
// the adapter normally while eval code still gets rich metadata.
//
// LLM instances are per-call in MoltNet usage: runSolver constructs a
// fresh claudecode.New / codex.New for each trial, so LastTrajectory()
// reflects exactly that trial. Do not share an LLM across goroutines.
type TrajectoryProvider interface {
	LastTrajectory() *GenerateResponse
}

// HeartbeatFunc is a callback invoked periodically during long-running
// CLI subprocess execution.
type HeartbeatFunc func(elapsed time.Duration)

// RunHeartbeat calls fn every 10 seconds until done is closed.
func RunHeartbeat(fn HeartbeatFunc, done <-chan struct{}) {
	ticker := time.NewTicker(10 * time.Second)
	defer ticker.Stop()
	start := time.Now()
	for {
		select {
		case <-done:
			return
		case <-ticker.C:
			fn(time.Since(start))
		}
	}
}

// ExtractLLMUsage reads LastUsage from an LLM, unwrapping decorators
// (e.g. ModelContextDecorator) as needed. Returns nil if the LLM
// does not implement UsageTracker.
func ExtractLLMUsage(llm core.LLM) *core.TokenInfo {
	if tracker, ok := llm.(UsageTracker); ok {
		return tracker.LastUsage()
	}
	type unwrapper interface{ Unwrap() core.LLM }
	if w, ok := llm.(unwrapper); ok {
		return ExtractLLMUsage(w.Unwrap())
	}
	return nil
}
