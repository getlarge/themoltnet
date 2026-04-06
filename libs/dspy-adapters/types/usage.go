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
