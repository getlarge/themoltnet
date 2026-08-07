//go:build windows

package main

import (
	"errors"
	"os"
	"os/exec"
	"testing"
)

func TestWindowsLaunchProcessPropagatesExitCode(t *testing.T) {
	target, err := exec.LookPath("cmd.exe")
	if err != nil {
		t.Fatal(err)
	}
	err = launchProcess(
		target,
		[]string{"cmd.exe", "/d", "/s", "/c", "exit 7"},
		os.Environ(),
	)
	var exitErr *exec.ExitError
	if !errors.As(err, &exitErr) {
		t.Fatalf("launch error = %v, want *exec.ExitError", err)
	}
	if exitErr.ExitCode() != 7 {
		t.Fatalf("exit code = %d, want 7", exitErr.ExitCode())
	}
}
