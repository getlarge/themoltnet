package main

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/getlarge/themoltnet/libs/dspy-adapters/solver"
)

func TestNeutralizeDSPYEvalWorktreeUsesGlobExcludes(t *testing.T) {
	dir := t.TempDir()

	if err := os.MkdirAll(filepath.Join(dir, ".agents", "skills"), 0o755); err != nil {
		t.Fatalf("mkdir .agents: %v", err)
	}
	if err := os.MkdirAll(filepath.Join(dir, "docs"), 0o755); err != nil {
		t.Fatalf("mkdir docs: %v", err)
	}
	if err := os.WriteFile(filepath.Join(dir, ".agents", "skills", "guide.md"), []byte("x"), 0o644); err != nil {
		t.Fatalf("write .agents file: %v", err)
	}
	if err := os.WriteFile(filepath.Join(dir, "docs", "guide.md"), []byte("x"), 0o644); err != nil {
		t.Fatalf("write docs guide: %v", err)
	}
	if err := os.WriteFile(filepath.Join(dir, "keep.go"), []byte("package main"), 0o644); err != nil {
		t.Fatalf("write go file: %v", err)
	}

	filter := newDSPYWorktreeFilter(evalRunOpts{
		worktreeExcludes: []string{"docs/*.md"},
	}, nil)
	if !filter.matches(".agents/skills/guide.md", false) {
		t.Fatal("expected default .agents exclusion to match")
	}
	if !filter.matches("docs/guide.md", false) {
		t.Fatal("expected custom docs glob to match")
	}
	if err := neutralizeDSPYEvalWorktree(dir, filter); err != nil {
		t.Fatalf("neutralizeDSPYEvalWorktree: %v", err)
	}

	if _, err := os.Stat(filepath.Join(dir, ".agents")); !os.IsNotExist(err) {
		t.Fatalf("expected .agents removed, got err=%v", err)
	}
	if _, err := os.Stat(filepath.Join(dir, "docs", "guide.md")); !os.IsNotExist(err) {
		t.Fatalf("expected docs markdown removed, got err=%v", err)
	}
	if _, err := os.Stat(filepath.Join(dir, "keep.go")); err != nil {
		t.Fatalf("expected keep.go preserved: %v", err)
	}
}

func TestDSPYWorktreeFilterMatchesDefaultsAndCustomGlobs(t *testing.T) {
	filter := newDSPYWorktreeFilter(evalRunOpts{
		worktreeExcludes: []string{
			"docs/*.md",
			"vendor/**",
			"agents/*.md",
		},
	}, nil)

	tests := []struct {
		rel   string
		isDir bool
		want  bool
	}{
		{rel: "AGENTS.md", want: true},
		{rel: ".claude/settings.json", want: true},
		{rel: ".agents/skills/guide.md", want: true},
		{rel: ".codex/config.toml", want: true},
		{rel: "tiles/skill-a/evals/scenario-1/task.md", want: true},
		{rel: "tiles/skill-a/evals/scenario-1/config.json", want: false},
		{rel: "docs/guide.md", want: true},
		{rel: "docs/nested/guide.md", want: false},
		{rel: "vendor/pkg/file.go", want: true},
		{rel: "agents/readme.md", want: true},
		{rel: "agents/readme.txt", want: false},
		{rel: "src/main.go", want: false},
	}

	for _, tt := range tests {
		if got := filter.matches(tt.rel, tt.isDir); got != tt.want {
			t.Errorf("filter.matches(%q, %v) = %v, want %v", tt.rel, tt.isDir, got, tt.want)
		}
	}
}

func TestCreateDSPYEvalWorktreeRequiresFrozenSourceRef(t *testing.T) {
	_, _, err := createDSPYEvalWorktree(t.TempDir(), "test", evalRunOpts{}, nil, "")
	if err == nil || !strings.Contains(err.Error(), "missing frozen dspy source ref") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestSparsePassDSPYEvalWorktree_KeepsTaskMD(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "task.md"), []byte("# Task"), 0o644); err != nil {
		t.Fatalf("write task.md: %v", err)
	}
	if err := os.WriteFile(filepath.Join(dir, "package.json"), []byte(`{"name":"app"}`), 0o644); err != nil {
		t.Fatalf("write package.json: %v", err)
	}
	if err := os.MkdirAll(filepath.Join(dir, "src"), 0o755); err != nil {
		t.Fatalf("mkdir src: %v", err)
	}
	if err := os.WriteFile(filepath.Join(dir, "src", "index.ts"), []byte("export {}"), 0o644); err != nil {
		t.Fatalf("write src/index.ts: %v", err)
	}

	include := []string{"task.md"}
	if err := sparsePassDSPYEvalWorktree(dir, include); err != nil {
		t.Fatalf("sparsePassDSPYEvalWorktree: %v", err)
	}

	if _, err := os.Stat(filepath.Join(dir, "task.md")); err != nil {
		t.Error("task.md should be kept")
	}
	if _, err := os.Stat(filepath.Join(dir, "package.json")); err == nil {
		t.Error("package.json should be removed")
	}
	if _, err := os.Stat(filepath.Join(dir, "src")); err == nil {
		t.Error("src/ should be removed")
	}
}

func TestSparsePassDSPYEvalWorktree_KeepsMultipleIncludes(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "task.md"), []byte("# Task"), 0o644); err != nil {
		t.Fatalf("write task.md: %v", err)
	}
	if err := os.WriteFile(filepath.Join(dir, "fixture.ts"), []byte("export const x = 1"), 0o644); err != nil {
		t.Fatalf("write fixture.ts: %v", err)
	}
	if err := os.WriteFile(filepath.Join(dir, "unrelated.go"), []byte("package main"), 0o644); err != nil {
		t.Fatalf("write unrelated.go: %v", err)
	}

	include := []string{"task.md", "fixture.ts"}
	if err := sparsePassDSPYEvalWorktree(dir, include); err != nil {
		t.Fatalf("sparsePassDSPYEvalWorktree: %v", err)
	}

	if _, err := os.Stat(filepath.Join(dir, "task.md")); err != nil {
		t.Error("task.md should be kept")
	}
	if _, err := os.Stat(filepath.Join(dir, "fixture.ts")); err != nil {
		t.Error("fixture.ts should be kept")
	}
	if _, err := os.Stat(filepath.Join(dir, "unrelated.go")); err == nil {
		t.Error("unrelated.go should be removed")
	}
}

func TestSparsePassDSPYEvalWorktree_KeepsGitDir(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "task.md"), []byte("# Task"), 0o644); err != nil {
		t.Fatalf("write task.md: %v", err)
	}
	if err := os.MkdirAll(filepath.Join(dir, ".git"), 0o755); err != nil {
		t.Fatalf("mkdir .git: %v", err)
	}
	if err := os.WriteFile(filepath.Join(dir, ".git", "config"), []byte("[core]"), 0o644); err != nil {
		t.Fatalf("write .git/config: %v", err)
	}

	include := []string{"task.md"}
	if err := sparsePassDSPYEvalWorktree(dir, include); err != nil {
		t.Fatalf("sparsePassDSPYEvalWorktree: %v", err)
	}

	if _, err := os.Stat(filepath.Join(dir, ".git")); err != nil {
		t.Error(".git should be preserved")
	}
}

// TestSparsePassDSPYEvalWorktree_KeepsGitFile verifies that .git as a
// gitdir-pointer file (the shape `git worktree add` creates) is preserved.
// The previous implementation only skipped .git when d.IsDir(), which
// silently deleted the pointer file in real git worktree checkouts.
func TestSparsePassDSPYEvalWorktree_KeepsGitFile(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "task.md"), []byte("# Task"), 0o644); err != nil {
		t.Fatalf("write task.md: %v", err)
	}
	gitPointer := []byte("gitdir: /tmp/repo/.git/worktrees/test\n")
	gitPath := filepath.Join(dir, ".git")
	if err := os.WriteFile(gitPath, gitPointer, 0o644); err != nil {
		t.Fatalf("write .git file: %v", err)
	}

	include := []string{"task.md"}
	if err := sparsePassDSPYEvalWorktree(dir, include); err != nil {
		t.Fatalf("sparsePassDSPYEvalWorktree: %v", err)
	}

	info, err := os.Stat(gitPath)
	if err != nil {
		t.Fatalf(".git should be preserved: %v", err)
	}
	if info.IsDir() {
		t.Fatal(".git should remain a file for worktree checkouts")
	}
	got, err := os.ReadFile(gitPath)
	if err != nil {
		t.Fatalf("read .git: %v", err)
	}
	if !bytes.Equal(got, gitPointer) {
		t.Fatalf(".git contents changed: got %q want %q", got, gitPointer)
	}
}

// TestSparsePassDSPYEvalWorktree_EmptyIncludeWipesAll verifies the vitro
// default: an empty include list produces a fully empty worktree except
// for .git. Vitro scenarios receive task instructions through the prompt,
// not the filesystem.
func TestSparsePassDSPYEvalWorktree_EmptyIncludeWipesAll(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "task.md"), []byte("# Task"), 0o644); err != nil {
		t.Fatalf("write task.md: %v", err)
	}
	if err := os.WriteFile(filepath.Join(dir, "package.json"), []byte(`{}`), 0o644); err != nil {
		t.Fatalf("write package.json: %v", err)
	}
	if err := os.MkdirAll(filepath.Join(dir, "src"), 0o755); err != nil {
		t.Fatalf("mkdir src: %v", err)
	}
	if err := os.WriteFile(filepath.Join(dir, ".git"), []byte("gitdir: x\n"), 0o644); err != nil {
		t.Fatalf("write .git: %v", err)
	}

	if err := sparsePassDSPYEvalWorktree(dir, nil); err != nil {
		t.Fatalf("sparsePassDSPYEvalWorktree: %v", err)
	}

	if _, err := os.Stat(filepath.Join(dir, "task.md")); err == nil {
		t.Error("task.md should be removed on empty include")
	}
	if _, err := os.Stat(filepath.Join(dir, "package.json")); err == nil {
		t.Error("package.json should be removed on empty include")
	}
	if _, err := os.Stat(filepath.Join(dir, "src")); err == nil {
		t.Error("src/ should be removed on empty include")
	}
	if _, err := os.Stat(filepath.Join(dir, ".git")); err != nil {
		t.Error(".git should be preserved even with empty include")
	}
}

// TestNeutralizeDSPYEvalWorktree_KeepsGitFile verifies .git-as-file
// preservation on the vivo path (neutralizeDSPYEvalWorktree).
func TestNeutralizeDSPYEvalWorktree_KeepsGitFile(t *testing.T) {
	dir := t.TempDir()
	gitPath := filepath.Join(dir, ".git")
	if err := os.WriteFile(gitPath, []byte("gitdir: /tmp/repo/.git/worktrees/test\n"), 0o644); err != nil {
		t.Fatalf("write .git: %v", err)
	}
	if err := os.WriteFile(filepath.Join(dir, "keep.txt"), []byte("x"), 0o644); err != nil {
		t.Fatalf("write keep.txt: %v", err)
	}

	filter := newDefaultDSPYWorktreeFilter()
	if err := neutralizeDSPYEvalWorktree(dir, filter); err != nil {
		t.Fatalf("neutralizeDSPYEvalWorktree: %v", err)
	}
	if _, err := os.Stat(gitPath); err != nil {
		t.Error(".git file should be preserved by neutralize pass")
	}
}

// TestDspyEvalSolver covers the precedence order from #720:
// CLI/preset override (opts.solverKind) > manifest.Solver > built-in default.
func TestDspyEvalSolver(t *testing.T) {
	tests := []struct {
		name     string
		manifest *evalManifest
		opts     evalRunOpts
		want     solver.Kind
		wantErr  bool
	}{
		{
			name:     "nil manifest, no opts → default cot",
			manifest: nil,
			opts:     evalRunOpts{},
			want:     solver.KindChainOfThought,
		},
		{
			name:     "empty manifest solver, no opts → default cot",
			manifest: &evalManifest{Mode: "vitro"},
			opts:     evalRunOpts{},
			want:     solver.KindChainOfThought,
		},
		{
			name:     "vivo mode, no solver, no opts → default react",
			manifest: &evalManifest{Mode: "vivo"},
			opts:     evalRunOpts{},
			want:     solver.KindReAct,
		},
		{
			name:     "vivo mode, explicit cot overrides default",
			manifest: &evalManifest{Mode: "vivo", Solver: "cot"},
			opts:     evalRunOpts{},
			want:     solver.KindChainOfThought,
		},
		{
			name:     "manifest react, no opts → react",
			manifest: &evalManifest{Mode: "vivo", Solver: "react"},
			opts:     evalRunOpts{},
			want:     solver.KindReAct,
		},
		{
			name:     "manifest cot, opts react → react (CLI wins)",
			manifest: &evalManifest{Mode: "vitro", Solver: "cot"},
			opts:     evalRunOpts{solverKind: solver.KindReAct},
			want:     solver.KindReAct,
		},
		{
			name:     "manifest react, opts cot → cot (CLI wins)",
			manifest: &evalManifest{Mode: "vivo", Solver: "react"},
			opts:     evalRunOpts{solverKind: solver.KindChainOfThought},
			want:     solver.KindChainOfThought,
		},
		{
			name:     "manifest bogus, no opts → error",
			manifest: &evalManifest{Mode: "vitro", Solver: "bogus"},
			opts:     evalRunOpts{},
			wantErr:  true,
		},
		{
			// Precedence short-circuit: CLI/preset override bypasses
			// the manifest path entirely, so a stale/malformed
			// manifest solver value never reaches ParseKind.
			name:     "bogus manifest solver ignored when CLI override set",
			manifest: &evalManifest{Mode: "vitro", Solver: "bogus"},
			opts:     evalRunOpts{solverKind: solver.KindChainOfThought},
			want:     solver.KindChainOfThought,
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got, err := dspyEvalSolver(tc.manifest, tc.opts)
			if tc.wantErr {
				if err == nil {
					t.Fatalf("expected error, got nil (got=%v)", got)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if got != tc.want {
				t.Errorf("got %q, want %q", got, tc.want)
			}
		})
	}
}

func TestInjectDSPYEvalFixtures_CopiesFiles(t *testing.T) {
	scenarioDir := t.TempDir()
	worktreeDir := t.TempDir()

	// Create source fixture file in scenario dir.
	if err := os.MkdirAll(filepath.Join(scenarioDir, "fixtures"), 0o755); err != nil {
		t.Fatal(err)
	}
	content := []byte(`{"entries":[{"idx":0}]}`)
	if err := os.WriteFile(filepath.Join(scenarioDir, "fixtures", "_journal.json"), content, 0o644); err != nil {
		t.Fatal(err)
	}

	injections := []evalManifestInject{
		{From: "fixtures/_journal.json", To: "libs/database/drizzle/meta/_journal.json"},
	}
	if err := injectDSPYEvalFixtures(worktreeDir, scenarioDir, injections); err != nil {
		t.Fatalf("injectDSPYEvalFixtures: %v", err)
	}

	// Verify the file landed at the correct path.
	got, err := os.ReadFile(filepath.Join(worktreeDir, "libs", "database", "drizzle", "meta", "_journal.json"))
	if err != nil {
		t.Fatalf("expected injected file to exist: %v", err)
	}
	if !bytes.Equal(got, content) {
		t.Errorf("injected content mismatch: got %q, want %q", got, content)
	}
}

func TestInjectDSPYEvalFixtures_OverwritesExisting(t *testing.T) {
	scenarioDir := t.TempDir()
	worktreeDir := t.TempDir()

	// Pre-existing file in worktree.
	targetDir := filepath.Join(worktreeDir, "meta")
	if err := os.MkdirAll(targetDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(targetDir, "config.json"), []byte("old"), 0o644); err != nil {
		t.Fatal(err)
	}

	// Source file in scenario dir.
	newContent := []byte("new")
	if err := os.WriteFile(filepath.Join(scenarioDir, "config.json"), newContent, 0o644); err != nil {
		t.Fatal(err)
	}

	injections := []evalManifestInject{
		{From: "config.json", To: "meta/config.json"},
	}
	if err := injectDSPYEvalFixtures(worktreeDir, scenarioDir, injections); err != nil {
		t.Fatalf("injectDSPYEvalFixtures: %v", err)
	}

	got, err := os.ReadFile(filepath.Join(worktreeDir, "meta", "config.json"))
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(got, newContent) {
		t.Errorf("expected overwritten content %q, got %q", newContent, got)
	}
}

func TestInjectDSPYEvalFixtures_MissingSource(t *testing.T) {
	scenarioDir := t.TempDir()
	worktreeDir := t.TempDir()

	injections := []evalManifestInject{
		{From: "nonexistent.json", To: "target.json"},
	}
	err := injectDSPYEvalFixtures(worktreeDir, scenarioDir, injections)
	if err == nil {
		t.Fatal("expected error for missing source file")
	}
}
