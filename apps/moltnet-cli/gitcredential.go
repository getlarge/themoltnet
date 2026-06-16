package main

import (
	"fmt"
	"os"
	"regexp"
	"strings"
)

// tokenRe matches an embedded GitHub token (server-to-server ghs_, personal
// ghp_, or any gh*_ variant) anywhere in a git config blob.
var tokenRe = regexp.MustCompile(`gh[a-z]_[A-Za-z0-9]+`)

// hasTokenBearingRule reports whether a git config blob contains an embedded
// GitHub token (the #1396 pollution pattern).
func hasTokenBearingRule(config string) bool {
	return tokenRe.MatchString(config)
}

// stripTokenBearingRules removes any git config section whose header carries an
// embedded GitHub token (e.g. [url "https://x-access-token:ghs_...@github.com/"])
// along with its indented body keys. Returns the cleaned blob.
func stripTokenBearingRules(config string) string {
	lines := strings.Split(config, "\n")
	out := make([]string, 0, len(lines))
	skipping := false
	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		isSectionHeader := strings.HasPrefix(trimmed, "[")
		if isSectionHeader {
			// A new section header ends any prior skip and decides whether
			// THIS section is poisoned.
			skipping = tokenRe.MatchString(line)
			if skipping {
				continue
			}
		} else if skipping {
			// Inside a poisoned section: drop indented body lines.
			continue
		}
		out = append(out, line)
	}
	return strings.Join(out, "\n")
}

// cleanGitConfigFile strips token-bearing rules from a git config file in
// place. Returns true if the file was modified.
func cleanGitConfigFile(path string) (bool, error) {
	b, err := os.ReadFile(path)
	if err != nil {
		return false, err
	}
	original := string(b)
	if !hasTokenBearingRule(original) {
		return false, nil
	}
	cleaned := stripTokenBearingRules(original)
	if cleaned == original {
		return false, nil
	}
	if err := os.WriteFile(path, []byte(cleaned), 0o644); err != nil {
		return false, err
	}
	return true, nil
}

// buildCredentialBlock returns the tokenless gitconfig block that wires the
// mint-on-demand GitHub credential helper plus the SSH->HTTPS insteadOf rule.
// credPath, when non-empty, is passed as an absolute --credentials path so the
// helper resolves the right agent from any CWD or worktree.
func buildCredentialBlock(credPath string) string {
	helper := "moltnet github credential-helper"
	if credPath != "" {
		helper += " --credentials " + credPath
	}
	return fmt.Sprintf(`[credential "https://github.com"]
	helper = "!%s"
[url "https://github.com/"]
	insteadOf = git@github.com:
`, helper)
}
