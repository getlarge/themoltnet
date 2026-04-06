package main

import (
	"fmt"
	"io"
	"os"
	"sync/atomic"
	"time"

	"github.com/vbauerster/mpb/v8"
	"github.com/vbauerster/mpb/v8/decor"
	"golang.org/x/term"
)

// Trial phases displayed in the progress bar.
const (
	phaseSettingUp    = "setting up"
	phaseAgentRunning = "agent running"
	phaseJudging      = "judging"
)

// progressTracker manages a set of concurrent trial progress bars.
// When stderr is not a TTY, it falls back to plain line-based output.
type progressTracker struct {
	p     *mpb.Progress
	w     io.Writer
	isTTY bool
}

// newProgressTracker creates a tracker that renders to w.
// If w is a *os.File backed by a terminal, it uses mpb animated bars.
// Otherwise it falls back to plain log lines.
func newProgressTracker(w io.Writer) *progressTracker {
	isTTY := false
	if f, ok := w.(*os.File); ok {
		isTTY = term.IsTerminal(int(f.Fd()))
	}

	pt := &progressTracker{w: w, isTTY: isTTY}
	if isTTY {
		pt.p = mpb.New(
			mpb.WithOutput(w),
			mpb.WithWidth(64),
			mpb.WithRefreshRate(150*time.Millisecond),
		)
	}
	return pt
}

// wait blocks until all bars complete. Must be called after all trials finish.
func (pt *progressTracker) wait() {
	if pt.p != nil {
		pt.p.Wait()
	}
}

// trialBar tracks progress for a single eval trial.
type trialBar struct {
	name  string
	bar   *mpb.Bar
	phase atomic.Value // stores string
	start time.Time
	w     io.Writer
	isTTY bool
}

// addTrial creates a new spinner bar for the named trial.
func (pt *progressTracker) addTrial(name string) *trialBar {
	tb := &trialBar{
		name:  name,
		start: time.Now(),
		w:     pt.w,
		isTTY: pt.isTTY,
	}
	tb.phase.Store(phaseSettingUp)

	if pt.isTTY && pt.p != nil {
		tb.bar = pt.p.AddSpinner(
			0,
			mpb.PrependDecorators(
				decor.Name(name, decor.WC{W: len(name) + 2, C: decor.DindentRight}),
				decor.Any(func(s decor.Statistics) string {
					p, _ := tb.phase.Load().(string)
					return p
				}, decor.WC{W: 20, C: decor.DindentRight}),
			),
			mpb.AppendDecorators(
				decor.Elapsed(decor.ET_STYLE_MMSS, decor.WC{W: 8}),
			),
		)
	} else {
		fmt.Fprintf(pt.w, "[eval] %s: %s\n", name, phaseSettingUp)
	}
	return tb
}

// setPhase updates the displayed phase label.
func (tb *trialBar) setPhase(phase string) {
	tb.phase.Store(phase)
	if !tb.isTTY {
		fmt.Fprintf(tb.w, "[eval] %s: %s\n", tb.name, phase)
	}
}

// complete marks the trial as successfully finished with a reward score.
func (tb *trialBar) complete(reward float64) {
	msg := fmt.Sprintf("done (%.1f%%)", reward*100)
	tb.phase.Store(msg)
	if tb.bar != nil {
		tb.bar.Abort(false)
	}
	if !tb.isTTY {
		elapsed := time.Since(tb.start).Round(time.Second)
		fmt.Fprintf(tb.w, "[eval] %s: %s [%s]\n", tb.name, msg, elapsed)
	}
}

// fail marks the trial as failed with an error reason.
func (tb *trialBar) fail(reason string) {
	msg := fmt.Sprintf("failed: %s", truncateProgress(reason, 60))
	tb.phase.Store(msg)
	if tb.bar != nil {
		tb.bar.Abort(false)
	}
	if !tb.isTTY {
		elapsed := time.Since(tb.start).Round(time.Second)
		fmt.Fprintf(tb.w, "[eval] %s: %s [%s]\n", tb.name, msg, elapsed)
	}
}

// heartbeatFor returns a HeartbeatFunc-compatible callback that updates
// the trial bar. In TTY mode the bar already shows elapsed via decor.Elapsed,
// so heartbeat only emits in non-TTY mode.
func (tb *trialBar) heartbeatFor() func(time.Duration) {
	return func(d time.Duration) {
		if !tb.isTTY {
			p, _ := tb.phase.Load().(string)
			fmt.Fprintf(tb.w, "[eval] %s: %s (%s elapsed)\n", tb.name, p, d.Round(time.Second))
		}
	}
}

func truncateProgress(s string, maxLen int) string {
	if len(s) <= maxLen {
		return s
	}
	return s[:maxLen] + "..."
}
