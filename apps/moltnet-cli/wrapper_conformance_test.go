package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"mvdan.cc/sh/v3/syntax"
)

// TestWrapperConformance asserts the shared cross-language fixtures: this Go
// guard and the TypeScript @themoltnet/shell-command-analyzer must resolve each
// command's prefix-runner (wrapper) chain to the same final executable. The
// fixture file is owned by the analyzer package and asserted by both, keeping
// the wrapper flag tables in sync without sharing parser code.
func TestWrapperConformance(t *testing.T) {
	t.Parallel()

	path := filepath.Join("..", "..", "libs", "shell-command-analyzer", "data", "wrapper-conformance.json")
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read fixture %s: %v", path, err)
	}
	var fixture struct {
		Cases []struct {
			Command string `json:"command"`
			Target  string `json:"target"`
		} `json:"cases"`
	}
	if err := json.Unmarshal(data, &fixture); err != nil {
		t.Fatalf("parse fixture: %v", err)
	}
	if len(fixture.Cases) == 0 {
		t.Fatal("no conformance cases found")
	}

	for _, c := range fixture.Cases {
		t.Run(c.Command, func(t *testing.T) {
			got := resolvePrefixRunnerTarget(t, c.Command)
			if got != c.Target {
				t.Fatalf("command %q: resolved executable %q, want %q", c.Command, got, c.Target)
			}
		})
	}
}

func resolvePrefixRunnerTarget(t *testing.T, command string) string {
	t.Helper()
	file, err := syntax.NewParser(syntax.Variant(syntax.LangBash)).Parse(strings.NewReader(command), "conformance")
	if err != nil {
		t.Fatalf("parse %q: %v", command, err)
	}
	var call *syntax.CallExpr
	syntax.Walk(file, func(node syntax.Node) bool {
		if call != nil {
			return false
		}
		if c, ok := node.(*syntax.CallExpr); ok && len(c.Args) > 0 {
			call = c
			return false
		}
		return true
	})
	if call == nil {
		t.Fatalf("no command found in %q", command)
	}
	executable, _, _, ok := parseShellInvocation(call, "")
	if !ok {
		t.Fatalf("could not resolve %q", command)
	}
	return filepath.Base(executable)
}
