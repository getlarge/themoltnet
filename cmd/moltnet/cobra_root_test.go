package main

import (
	"bytes"
	"strings"
	"testing"

	"github.com/spf13/cobra"
)

// executeCommand runs a cobra command with the given args and captures output.
func executeCommand(root *cobra.Command, args ...string) (stdout string, stderr string, err error) {
	var outBuf, errBuf bytes.Buffer
	root.SetOut(&outBuf)
	root.SetErr(&errBuf)
	root.SetArgs(args)
	err = root.Execute()
	return outBuf.String(), errBuf.String(), err
}

func TestRootHelp(t *testing.T) {
	t.Parallel()
	root := NewRootCmd("test", "")
	stdout, _, err := executeCommand(root, "--help")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !strings.Contains(stdout, "moltnet") {
		t.Errorf("expected help output to contain 'moltnet', got: %s", stdout)
	}
	if !strings.Contains(stdout, "Usage:") || !strings.Contains(stdout, "Flags:") {
		t.Errorf("expected help output to contain usage and flags sections, got: %s", stdout)
	}
}

func TestRootNoArgs(t *testing.T) {
	t.Parallel()
	root := NewRootCmd("test", "")
	stdout, _, err := executeCommand(root)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	// With no args and no RunE, cobra prints help
	if !strings.Contains(stdout, "Usage:") {
		t.Errorf("expected usage output with no args, got: %s", stdout)
	}
}

func TestVersionCommand(t *testing.T) {
	t.Parallel()
	t.Run("version only", func(t *testing.T) {
		t.Parallel()
		root := NewRootCmd("1.2.3", "")
		stdout, _, err := executeCommand(root, "version")
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		expected := "moltnet 1.2.3\n"
		if stdout != expected {
			t.Errorf("expected %q, got %q", expected, stdout)
		}
	})

	t.Run("version with commit", func(t *testing.T) {
		t.Parallel()
		root := NewRootCmd("1.2.3", "abc1234")
		stdout, _, err := executeCommand(root, "version")
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		expected := "moltnet 1.2.3 (abc1234)\n"
		if stdout != expected {
			t.Errorf("expected %q, got %q", expected, stdout)
		}
	})
}
