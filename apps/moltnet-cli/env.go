package main

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"github.com/joho/godotenv"
)

// toEnvPrefix converts an agent name to an uppercase env-var prefix.
// "my-agent" → "MY_AGENT", matching the TS toEnvPrefix in setup.ts.
func toEnvPrefix(agentName string) string {
	return strings.Map(func(r rune) rune {
		if r >= 'a' && r <= 'z' {
			return r - 32
		}
		if (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') {
			return r
		}
		return '_'
	}, agentName)
}

// parseEnvFile reads a shell-sourceable env file and returns key=value pairs.
func parseEnvFile(path string) (map[string]string, error) {
	return godotenv.Read(path)
}

// resolveMoltnetDir finds the .moltnet/ directory, checking cwd first,
// then falling back to the main worktree root if in a git worktree.
func resolveMoltnetDir(cwd string) (string, error) {
	moltnetDir, _, err := resolveMoltnetDirAndRoot(cwd)
	return moltnetDir, err
}

// resolveMoltnetDirAndRoot returns both the .moltnet/ directory and the main
// worktree root. When called from a linked worktree, the returned root is the
// main worktree (parent of git-common-dir), not the linked worktree path. This
// keeps any agent state shared across worktrees (e.g. activation cache) keyed
// on the same root the .moltnet/ symlink actually points at, instead of
// invalidating every time the user switches worktrees.
func resolveMoltnetDirAndRoot(cwd string) (moltnetDir, mainRoot string, err error) {
	candidate := filepath.Join(cwd, ".moltnet")
	if info, statErr := os.Stat(candidate); statErr == nil && info.IsDir() {
		root := canonicalizeRoot(cwd)
		return filepath.Join(root, ".moltnet"), root, nil
	}

	// Check if we're in a git worktree
	cmd := exec.Command("git", "rev-parse", "--git-common-dir")
	cmd.Dir = cwd
	out, runErr := cmd.Output()
	if runErr != nil {
		return "", "", fmt.Errorf(".moltnet/ not found in %s and not in a git repo", cwd)
	}
	gitCommonDir := strings.TrimSpace(string(out))
	if gitCommonDir == "" || gitCommonDir == ".git" {
		return "", "", fmt.Errorf(".moltnet/ not found in %s", cwd)
	}

	// gitCommonDir is relative or absolute — resolve it
	if !filepath.IsAbs(gitCommonDir) {
		gitCommonDir = filepath.Join(cwd, gitCommonDir)
	}
	// gitCommonDir points to .git in the main worktree; parent is the worktree root
	mainRoot = canonicalizeRoot(filepath.Dir(gitCommonDir))
	candidate = filepath.Join(mainRoot, ".moltnet")
	if info, statErr := os.Stat(candidate); statErr == nil && info.IsDir() {
		// Also canonicalize the moltnet dir itself in case it's a symlink
		// (e.g. linked worktrees frequently symlink .moltnet → main repo's
		// .moltnet so identity files are shared across worktrees).
		return canonicalizeRoot(candidate), mainRoot, nil
	}
	return "", "", fmt.Errorf(".moltnet/ not found in %s or main worktree %s", cwd, mainRoot)
}

// canonicalizeRoot returns a stable absolute path for use as the activation
// cache key. Resolves symlinks so the same root produced from different CWDs
// (e.g. /var → /private/var on macOS, or a worktree resolving its main via
// git-common-dir) compares equal.
func canonicalizeRoot(path string) string {
	if resolved, err := filepath.EvalSymlinks(path); err == nil {
		return filepath.Clean(resolved)
	}
	return filepath.Clean(path)
}

// resolveAgentName determines which agent to use.
// Priority: flagValue > .moltnet/default-agent > single agent > error.
func resolveAgentName(moltnetDir, flagValue string) (string, error) {
	if flagValue != "" {
		agentDir := filepath.Join(moltnetDir, flagValue)
		if _, err := os.Stat(filepath.Join(agentDir, "moltnet.json")); err != nil {
			return "", fmt.Errorf("agent %q not found in %s — run 'legreffier init --name %s'", flagValue, moltnetDir, flagValue)
		}
		return flagValue, nil
	}

	// Check default-agent file
	defaultPath := filepath.Join(moltnetDir, "default-agent")
	if data, err := os.ReadFile(defaultPath); err == nil {
		name := strings.TrimSpace(string(data))
		if name != "" {
			agentDir := filepath.Join(moltnetDir, name)
			if _, err := os.Stat(filepath.Join(agentDir, "moltnet.json")); err != nil {
				return "", fmt.Errorf("default agent %q not found — run 'moltnet use <agent>' to fix", name)
			}
			return name, nil
		}
	}

	// Scan for agent directories (subdirs containing moltnet.json)
	entries, err := os.ReadDir(moltnetDir)
	if err != nil {
		return "", fmt.Errorf("read %s: %w", moltnetDir, err)
	}
	var agents []string
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		if _, err := os.Stat(filepath.Join(moltnetDir, e.Name(), "moltnet.json")); err == nil {
			agents = append(agents, e.Name())
		}
	}

	switch len(agents) {
	case 0:
		return "", fmt.Errorf("no agents found in %s — run 'legreffier init --name <agent>'", moltnetDir)
	case 1:
		return agents[0], nil
	default:
		return "", fmt.Errorf("multiple agents found: %s — run 'moltnet use <agent>' to set a default", strings.Join(agents, ", "))
	}
}
