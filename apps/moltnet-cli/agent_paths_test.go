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

func TestPortableAgentEnvPath(t *testing.T) {
	t.Parallel()

	repoRoot := filepath.Join(string(filepath.Separator), "workspace", "repo")
	agentDir := filepath.Join(repoRoot, ".moltnet", "legreffier")
	pemPath := filepath.Join(agentDir, "legreffier.pem")

	got := portableAgentEnvPath(agentDir, "legreffier", pemPath)
	want := ".moltnet/legreffier/legreffier.pem"
	if got != want {
		t.Fatalf("portable path = %q, want %q", got, want)
	}
}

func TestPortableAgentEnvPathKeepsExternalPath(t *testing.T) {
	t.Parallel()

	agentDir := filepath.Join(string(filepath.Separator), "workspace", "repo", ".moltnet", "legreffier")
	externalPath := filepath.Join(string(filepath.Separator), "tmp", "legreffier.pem")

	got := portableAgentEnvPath(agentDir, "legreffier", externalPath)
	if got != externalPath {
		t.Fatalf("portable path = %q, want %q", got, externalPath)
	}
}

func TestPortableAgentEnvPathKeepsRelativePath(t *testing.T) {
	t.Parallel()

	agentDir := filepath.Join(string(filepath.Separator), "workspace", "repo", ".moltnet", "legreffier")
	relativePath := filepath.Join(".moltnet", "legreffier", "legreffier.pem")

	got := portableAgentEnvPath(agentDir, "legreffier", relativePath)
	if got != relativePath {
		t.Fatalf("portable path = %q, want %q", got, relativePath)
	}
}
