package main

import (
	"bytes"
	"strings"
	"testing"
)

func TestProgressTracker_NonTTY_FallsBackToLines(t *testing.T) {
	var buf bytes.Buffer
	pt := newProgressTracker(&buf)

	tb := pt.addTrial("test-scenario")
	if tb.isTTY {
		t.Fatal("expected non-TTY mode for bytes.Buffer")
	}

	tb.setPhase(phaseAgentRunning)
	tb.complete(0.85)
	pt.wait()

	output := buf.String()
	if !strings.Contains(output, "[eval] test-scenario: setting up") {
		t.Errorf("missing initial phase line, got:\n%s", output)
	}
	if !strings.Contains(output, "[eval] test-scenario: agent running") {
		t.Errorf("missing agent running phase line, got:\n%s", output)
	}
	if !strings.Contains(output, "done (85.0%)") {
		t.Errorf("missing completion line, got:\n%s", output)
	}
}

func TestProgressTracker_NonTTY_FailOutput(t *testing.T) {
	var buf bytes.Buffer
	pt := newProgressTracker(&buf)

	tb := pt.addTrial("fail-scenario")
	tb.setPhase(phaseAgentRunning)
	tb.fail("auth_error: OAuth token expired")
	pt.wait()

	output := buf.String()
	if !strings.Contains(output, "failed: auth_error: OAuth token expired") {
		t.Errorf("missing failure line, got:\n%s", output)
	}
}

func TestProgressTracker_NonTTY_HeartbeatEmitsLine(t *testing.T) {
	var buf bytes.Buffer
	pt := newProgressTracker(&buf)

	tb := pt.addTrial("heartbeat-scenario")
	tb.setPhase(phaseAgentRunning)

	hb := tb.heartbeatFor()
	hb(30_000_000_000) // 30 seconds as time.Duration

	pt.wait()

	output := buf.String()
	if !strings.Contains(output, "30s elapsed") {
		t.Errorf("missing heartbeat line, got:\n%s", output)
	}
}

func TestTruncate(t *testing.T) {
	short := "hello"
	if got := truncate(short, 10); got != "hello" {
		t.Errorf("expected %q, got %q", "hello", got)
	}
	long := "this is a very long error message that should be truncated"
	got := truncate(long, 20)
	if len(got) != 23 { // 20 + "..."
		t.Errorf("expected length 23, got %d: %q", len(got), got)
	}
	if !strings.HasSuffix(got, "...") {
		t.Errorf("expected ... suffix, got %q", got)
	}
}
