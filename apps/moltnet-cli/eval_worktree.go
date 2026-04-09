package main

import (
	"bytes"
	"fmt"
	"os"
	"os/exec"
	"path"
	"path/filepath"
	"sort"
	"strings"
	"sync"

	"github.com/getlarge/themoltnet/libs/dspy-adapters/solver"
)

// worktreeMu serializes git worktree add/remove operations to avoid
// index.lock races when running variants concurrently.
var worktreeMu sync.Mutex

type dspyWorktreeFilter struct {
	excludeGlobs []string
}

func newDefaultDSPYWorktreeFilter() dspyWorktreeFilter {
	return dspyWorktreeFilter{
		excludeGlobs: []string{
			"AGENTS.md",
			"CLAUDE.md",
			".claude",
			".claude/**",
			".agents",
			".agents/**",
			".codex",
			".codex/**",
			"tiles/**/*.md",
		},
	}
}

// newDSPYWorktreeFilter merges user-supplied --worktree-exclude globs with the
// default filter. Currently additive only: user globs extend the defaults.
//
// TODO: consider making this a replace/absolute mode so users can provide the
// complete exclude list when they want full control (e.g. to preserve their own
// CLAUDE.md or AGENTS.md from the repo). Right now the defaults always apply
// and user globs can only add more paths to remove.
func newDSPYWorktreeFilter(opts evalRunOpts, manifest *evalManifest) dspyWorktreeFilter {
	filter := newDefaultDSPYWorktreeFilter()
	for _, glob := range opts.worktreeExcludes {
		glob = strings.Trim(strings.TrimSpace(filepath.ToSlash(glob)), "/")
		if glob == "" {
			continue
		}
		filter.excludeGlobs = append(filter.excludeGlobs, glob)
	}
	if manifest != nil {
		for _, glob := range manifest.Fixture.Exclude {
			glob = strings.Trim(strings.TrimSpace(filepath.ToSlash(glob)), "/")
			if glob == "" {
				continue
			}
			filter.excludeGlobs = append(filter.excludeGlobs, glob)
		}
	}
	sort.Strings(filter.excludeGlobs)
	return filter
}

// dspyEvalMode returns the effective mode for a variant run.
// CLI --mode overrides eval.json; absent eval.json = legacy full-HEAD.
func dspyEvalMode(manifest *evalManifest, opts evalRunOpts) string {
	if opts.dspyMode != "" {
		return opts.dspyMode
	}
	if manifest != nil {
		return manifest.Mode
	}
	return ""
}

// dspyEvalSolver resolves the effective solver kind for a variant run.
// Precedence: CLI/preset override (opts.solverKind) > eval.json solver >
// built-in default (solver.KindChainOfThought). Manifest values have
// already been validated by validateEvalManifest, so ParseKind on a
// non-empty value should not fail here in normal flows; any error is
// surfaced to the caller for defensive safety.
func dspyEvalSolver(manifest *evalManifest, opts evalRunOpts) (solver.Kind, error) {
	if opts.solverKind != "" {
		return opts.solverKind, nil
	}
	if manifest != nil && manifest.Solver != "" {
		k, err := solver.ParseKind(manifest.Solver)
		if err != nil {
			return "", err
		}
		return k, nil
	}
	return solver.KindChainOfThought, nil
}

func createDSPYEvalWorktree(parentDir, label string, opts evalRunOpts, manifest *evalManifest) (string, func() error, error) {
	if opts.dspyRepoRoot == "" || opts.dspySourceRef == "" {
		return "", nil, fmt.Errorf("missing frozen dspy source ref")
	}

	worktreeDir := filepath.Join(parentDir, "workspace")
	worktreeMu.Lock()
	addErr := gitRun(opts.dspyRepoRoot, "worktree", "add", "--detach", worktreeDir, opts.dspySourceRef)
	worktreeMu.Unlock()
	if addErr != nil {
		return "", nil, fmt.Errorf("create dspy worktree for %s: %w", label, addErr)
	}

	mode := dspyEvalMode(manifest, opts)
	var neutralizeErr error
	switch mode {
	case "vitro":
		// Vitro is a blank-slate worktree: the agent receives task
		// instructions through the prompt (solverInput.task_description),
		// not through the filesystem. Default include is empty — sparse
		// pass wipes everything except .git. Scenarios that need on-disk
		// fixtures declare them explicitly via fixture.include.
		var include []string
		if manifest != nil {
			include = manifest.Fixture.Include
		}
		neutralizeErr = sparsePassDSPYEvalWorktree(worktreeDir, include)
	default:
		neutralizeErr = neutralizeDSPYEvalWorktree(worktreeDir, newDSPYWorktreeFilter(opts, manifest))
	}
	if neutralizeErr != nil {
		worktreeMu.Lock()
		cleanupErr := gitRun(opts.dspyRepoRoot, "worktree", "remove", "--force", worktreeDir)
		worktreeMu.Unlock()
		if cleanupErr != nil {
			return "", nil, fmt.Errorf("neutralize dspy worktree: %w; cleanup worktree: %v", neutralizeErr, cleanupErr)
		}
		return "", nil, fmt.Errorf("neutralize dspy worktree: %w", neutralizeErr)
	}

	cleanup := func() error {
		worktreeMu.Lock()
		defer worktreeMu.Unlock()
		return gitRun(opts.dspyRepoRoot, "worktree", "remove", "--force", worktreeDir)
	}
	return worktreeDir, cleanup, nil
}

func resolveDSPYEvalSource(opts evalRunOpts, manifest *evalManifest) (string, string, error) {
	repoRoot, err := currentRepoRoot()
	if err != nil {
		return "", "", err
	}
	ref := ""
	if opts.dspyFixtureRef != "" {
		ref = opts.dspyFixtureRef
	} else if manifest != nil && manifest.Fixture.Ref != "" {
		ref = manifest.Fixture.Ref
	}
	if ref == "" {
		headRef, err := gitOutput(repoRoot, "rev-parse", "HEAD")
		if err != nil {
			return "", "", fmt.Errorf("resolve dspy source ref: %w", err)
		}
		return repoRoot, strings.TrimSpace(headRef), nil
	}
	resolvedRef, err := gitOutput(repoRoot, "rev-parse", "--verify", ref)
	if err != nil {
		return "", "", fmt.Errorf("fixture.ref %q does not resolve in this repo: %w", ref, err)
	}
	return repoRoot, strings.TrimSpace(resolvedRef), nil
}

func currentRepoRoot() (string, error) {
	wd, err := os.Getwd()
	if err != nil {
		return "", fmt.Errorf("get working directory: %w", err)
	}
	root, err := gitOutput(wd, "rev-parse", "--show-toplevel")
	if err != nil {
		return "", fmt.Errorf("resolve repo root: %w", err)
	}
	return strings.TrimSpace(root), nil
}

func gitOutput(cwd string, args ...string) (string, error) {
	cmd := exec.Command("git", args...)
	cmd.Dir = cwd
	out, err := cmd.Output()
	if err != nil {
		return "", err
	}
	return string(out), nil
}

func gitRun(cwd string, args ...string) error {
	// Buffer git's output so its "Preparing worktree (...)" lines don't
	// interleave with mpb's cursor-movement redraws. Only emit on error.
	cmd := exec.Command("git", args...)
	cmd.Dir = cwd
	var buf bytes.Buffer
	cmd.Stdout = &buf
	cmd.Stderr = &buf
	if err := cmd.Run(); err != nil {
		if buf.Len() > 0 {
			fmt.Fprint(os.Stderr, buf.String())
		}
		return err
	}
	return nil
}

func neutralizeDSPYEvalWorktree(worktreeDir string, filter dspyWorktreeFilter) error {
	return filepath.WalkDir(worktreeDir, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			if os.IsNotExist(err) {
				return nil
			}
			return err
		}
		if path == worktreeDir {
			return nil
		}
		// Preserve .git regardless of whether it is a directory or a
		// gitdir-pointer file. `git worktree add` creates .git as a file
		// (pointing at $GIT_DIR/worktrees/<name>), not a directory.
		if filepath.Base(path) == ".git" {
			if d.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		if d.IsDir() {
			if filter.matches(relPath(worktreeDir, path), true) {
				if err := os.RemoveAll(path); err != nil && !os.IsNotExist(err) {
					return err
				}
				return filepath.SkipDir
			}
			return nil
		}
		if filter.matches(relPath(worktreeDir, path), false) {
			if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
				return err
			}
		}
		return nil
	})
}

// sparsePassDSPYEvalWorktree removes everything from worktreeDir except:
//   - paths listed in include (relative to worktreeDir). An empty include
//     list produces a fully empty worktree — the vitro default.
//   - .git, regardless of whether it is a directory or a file. `git worktree
//     add` creates .git as a gitdir-pointer file; the main repo's .git is a
//     directory. Both are preserved so `git worktree remove` cleanup works.
//
// Runner-written files (context-pack.md, CLAUDE.md, AGENTS.md) are written
// by writeDSPYEvalPackToDisk AFTER this pass, so they don't need to be listed.
//
// Isolation tradeoff: preserving .git means the agent can use git plumbing
// (`git show`, `git cat-file`, `git log`) to read blobs that were removed
// from the working tree. Vitro isolation is therefore a "sparse filesystem
// view", NOT a cryptographic air gap. A scenario that relies on the agent
// being unable to see a specific file must not assume vitro hides it from
// git-aware tooling. Full isolation would require `git archive | tar -x`
// into a plain tempdir (no .git at all), which is tracked as a follow-up.
func sparsePassDSPYEvalWorktree(worktreeDir string, include []string) error {
	allowset := make(map[string]bool, len(include)+1)
	for _, p := range include {
		p = strings.Trim(strings.TrimSpace(filepath.ToSlash(p)), "/")
		if p != "" {
			allowset[p] = true
		}
	}

	return filepath.WalkDir(worktreeDir, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			if os.IsNotExist(err) {
				return nil
			}
			return err
		}
		if path == worktreeDir {
			return nil
		}
		rel := relPath(worktreeDir, path)
		// Preserve .git regardless of whether it's a directory (main repo)
		// or a gitdir-pointer file (git worktree checkouts).
		if filepath.Base(path) == ".git" {
			if d.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		if d.IsDir() {
			hasAllowedChild := false
			for allowed := range allowset {
				if strings.HasPrefix(allowed, rel+"/") {
					hasAllowedChild = true
					break
				}
			}
			if !hasAllowedChild && !allowset[rel] {
				if err := os.RemoveAll(path); err != nil && !os.IsNotExist(err) {
					return err
				}
				return filepath.SkipDir
			}
			return nil
		}
		if !allowset[rel] {
			if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
				return err
			}
		}
		return nil
	})
}

func relPath(base, p string) string {
	rel, err := filepath.Rel(base, p)
	if err != nil {
		return p
	}
	return filepath.ToSlash(rel)
}

func (f dspyWorktreeFilter) matches(rel string, isDir bool) bool {
	rel = strings.Trim(strings.TrimSpace(filepath.ToSlash(rel)), "/")
	if rel == "" {
		return false
	}
	for _, glob := range f.excludeGlobs {
		glob = strings.Trim(strings.TrimSpace(filepath.ToSlash(glob)), "/")
		if glob == "" {
			continue
		}
		if glob == rel {
			return true
		}
		if strings.HasSuffix(glob, "/**") {
			prefix := strings.TrimSuffix(glob, "/**")
			if rel == prefix || strings.HasPrefix(rel, prefix+"/") {
				return true
			}
		}
		matched, err := doublestarMatch(glob, rel)
		if err == nil && matched {
			return true
		}
		if isDir {
			matched, err = doublestarMatch(filepath.ToSlash(filepath.Join(glob, "*")), rel)
			if err == nil && matched {
				return true
			}
		}
	}
	return false
}

func doublestarMatch(pattern, name string) (bool, error) {
	pattern = strings.Trim(strings.TrimSpace(filepath.ToSlash(pattern)), "/")
	name = strings.Trim(strings.TrimSpace(filepath.ToSlash(name)), "/")
	return matchSegments(strings.Split(pattern, "/"), strings.Split(name, "/"))
}

func matchSegments(patternParts, nameParts []string) (bool, error) {
	if len(patternParts) == 0 {
		return len(nameParts) == 0, nil
	}

	if patternParts[0] == "**" {
		if len(patternParts) == 1 {
			return true, nil
		}
		for i := 0; i <= len(nameParts); i++ {
			matched, err := matchSegments(patternParts[1:], nameParts[i:])
			if err != nil {
				return false, err
			}
			if matched {
				return true, nil
			}
		}
		return false, nil
	}

	if len(nameParts) == 0 {
		return false, nil
	}

	matched, err := path.Match(patternParts[0], nameParts[0])
	if err != nil || !matched {
		return false, err
	}
	return matchSegments(patternParts[1:], nameParts[1:])
}
