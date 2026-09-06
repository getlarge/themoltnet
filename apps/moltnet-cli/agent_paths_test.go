package main

import (
	"path/filepath"
	"reflect"
	"testing"
)

func TestAgentPathResolverCandidates(t *testing.T) {
	t.Parallel()

	repoRoot := filepath.Join(string(filepath.Separator), "workspace", "repo")
	agentDir := filepath.Join(repoRoot, ".moltnet", "legreffier")
	resolver := newAgentPathResolver(repoRoot, agentDir, "legreffier")

	configured := filepath.Join(
		string(filepath.Separator),
		"Users",
		"edouard",
		"Dev",
		"getlarge",
		"themolt",
		".moltnet",
		"legreffier",
		"gitconfig",
	)

	want := []string{
		configured,
		filepath.Join(agentDir, "gitconfig"),
	}
	got := resolver.candidatePaths(configured, "gitconfig")
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("candidates = %#v, want %#v", got, want)
	}
}

func TestAgentPathResolverRelativeConfiguredPath(t *testing.T) {
	t.Parallel()

	repoRoot := filepath.Join(string(filepath.Separator), "workspace", "repo")
	agentDir := filepath.Join(repoRoot, ".moltnet", "legreffier")
	resolver := newAgentPathResolver(repoRoot, agentDir, "legreffier")

	got := resolver.candidatePaths(".moltnet/legreffier/gitconfig", "gitconfig")
	want := []string{filepath.Join(agentDir, "gitconfig")}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("candidates = %#v, want %#v", got, want)
	}
}
