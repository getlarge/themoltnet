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
// captures the full CLI event stream (not just the final text). Every
// Generate call appends one GenerateResponse to an internal buffer so
// dspy-go modules (ChainOfThought, ReAct) can drive the adapter
// normally while eval code still gets rich per-call metadata.
//
// Trajectories returns the full list in call order — required for
// multi-step modules like ReAct where each iteration issues a fresh
// Generate. LastTrajectory returns only the final entry (equivalent to
// Trajectories()[len-1]) as a convenience for single-call modules like
// ChainOfThought. Both return nil / empty slice before any Generate
// call completes.
//
// Note: only Generate populates the buffer. GenerateWithJSON uses a
// separate non-streaming CLI path and does not update trajectories —
// the judge (which is the only GenerateWithJSON consumer in MoltNet)
// reads token usage via UsageTracker.LastUsage instead.
//
// LLM instances are per-call in MoltNet usage: runSolver constructs a
// fresh claudecode.New / codex.New for each trial, so the buffer
// reflects exactly that trial. Do not share an LLM across goroutines —
// the trajectory buffer is not synchronized.
type TrajectoryProvider interface {
	// LastTrajectory returns the most recent Generate trajectory, or
	// nil if Generate has not been called.
	LastTrajectory() *GenerateResponse
	// Trajectories returns all Generate trajectories in call order, or
	// an empty slice if Generate has not been called. The returned
	// slice is a reference to the adapter's internal buffer — do not
	// mutate.
	Trajectories() []*GenerateResponse
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
