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

// githubCredHeaderRe matches the github.com credential section header,
// tolerating optional whitespace and the trailing-slash URL variant.
var githubCredHeaderRe = regexp.MustCompile(
	`(?m)^\[credential "https://github\.com/?"\]\s*$`,
)

// needsHelperReset reports whether a gitconfig has a github.com credential
// helper but lacks the empty `helper = ""` reset that makes the agent helper
// authoritative over an inherited generic helper (osxkeychain/store). Such a
// block is shadow-prone (#1396 regression risk).
func needsHelperReset(gitconfig string) bool {
	loc := githubCredHeaderRe.FindStringIndex(gitconfig)
	if loc == nil {
		return false // no github.com credential section at all
	}
	section := githubCredSection(gitconfig, loc[1])
	hasHelper := strings.Contains(section, "credential-helper")
	hasReset := strings.Contains(section, `helper = ""`) ||
		regexp.MustCompile(`(?m)^\s*helper\s*=\s*$`).MatchString(section)
	return hasHelper && !hasReset
}

// addHelperReset inserts an empty `helper = ""` reset line immediately after
// the github.com credential section header, before any real helper. Idempotent
// for callers that gate on needsHelperReset.
func addHelperReset(gitconfig string) string {
	loc := githubCredHeaderRe.FindStringIndex(gitconfig)
	if loc == nil {
		return gitconfig
	}
	// Insert right after the header line's trailing newline.
	insertAt := loc[1]
	if insertAt < len(gitconfig) && gitconfig[insertAt] == '\n' {
		insertAt++
	}
	return gitconfig[:insertAt] + "\thelper = \"\"\n" + gitconfig[insertAt:]
}

// githubCredSection returns the text from the github.com credential header
// (starting at headerEnd) up to the next section header or EOF.
func githubCredSection(gitconfig string, headerEnd int) string {
	rest := gitconfig[headerEnd:]
	if next := regexp.MustCompile(`(?m)^\[`).FindStringIndex(rest); next != nil {
		return rest[:next[0]]
	}
	return rest
}

// buildCredentialBlock returns the tokenless gitconfig block that wires the
// mint-on-demand GitHub credential helper plus the SSH->HTTPS insteadOf rule.
// credPath, when non-empty, is passed as an absolute --credentials path so the
// helper resolves the right agent from any CWD or worktree.
//
// The leading `helper = ""` resets any generic credential helper inherited from
// a broader scope (system/global `credential.helper`, e.g. osxkeychain or
// store) for github.com. Without it, git consults the inherited helper first
// and uses the FIRST password it returns — a stale token cached in the
// keychain would shadow this helper and reintroduce the #1396 401-on-stale
// failure. The empty reset makes the agent helper authoritative for github.com.
func buildCredentialBlock(credPath string) string {
	helper := "moltnet github credential-helper"
	if credPath != "" {
		helper += " --credentials " + credPath
	}
	return fmt.Sprintf(`[credential "https://github.com"]
	helper = ""
	helper = "!%s"
[url "https://github.com/"]
	insteadOf = git@github.com:
`, helper)
}
