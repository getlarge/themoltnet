// Package dspytypes provides shared types for dspy-go LLM adapters.
// It is a leaf package with no adapter imports, breaking import cycles.
package dspytypes

import (
	"context"
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

// TrajectoryGenerator is implemented by adapters that can capture
// raw event streams during generation.
type TrajectoryGenerator interface {
	GenerateWithTrajectory(ctx context.Context, prompt string) (*GenerateResponse, error)
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
