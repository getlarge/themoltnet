package main

import (
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"

	"github.com/spf13/cobra"
)

type envConfigureOptions struct {
	Dir, Agent                  string
	TeamID, DiaryID, Authorship string
	HumanGitIdentity            string
	ClearTeamID, ClearDiaryID   bool
	ClearHumanGitIdentity       bool
}

var envAssignmentPattern = regexp.MustCompile(`^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=`)

func runEnvConfigureCmd(cmd *cobra.Command, opts envConfigureOptions, changed func(string) bool) error {
	if changed("team-id") && opts.ClearTeamID {
		return fmt.Errorf("--team-id and --clear-team-id are mutually exclusive")
	}
	if changed("diary-id") && opts.ClearDiaryID {
		return fmt.Errorf("--diary-id and --clear-diary-id are mutually exclusive")
	}
	if changed("human-git-identity") && opts.ClearHumanGitIdentity {
		return fmt.Errorf("--human-git-identity and --clear-human-git-identity are mutually exclusive")
	}
	if changed("authorship") && opts.Authorship != "agent" && opts.Authorship != "human" && opts.Authorship != "coauthor" {
		return fmt.Errorf("--authorship must be agent, human, or coauthor")
	}
	if changed("human-git-identity") && !isValidGitIdentity(opts.HumanGitIdentity) {
		return fmt.Errorf("--human-git-identity must use Name <email> format")
	}

	moltnetDir, err := resolveMoltnetDir(opts.Dir)
	if err != nil {
		return err
	}
	agentName, err := resolveAgentName(moltnetDir, opts.Agent)
	if err != nil {
		return err
	}
	envPath := filepath.Join(moltnetDir, agentName, "env")

	updates := map[string]*string{}
	set := func(flag, key, value string, clear bool) {
		if changed(flag) {
			v := value
			updates[key] = &v
		}
		if clear {
			updates[key] = nil
		}
	}
	set("team-id", "MOLTNET_TEAM_ID", opts.TeamID, opts.ClearTeamID)
	set("diary-id", "MOLTNET_DIARY_ID", opts.DiaryID, opts.ClearDiaryID)
	set("authorship", "MOLTNET_COMMIT_AUTHORSHIP", opts.Authorship, false)
	set("human-git-identity", "MOLTNET_HUMAN_GIT_IDENTITY", opts.HumanGitIdentity, opts.ClearHumanGitIdentity)
	if len(updates) == 0 {
		return fmt.Errorf("no settings selected; pass at least one configuration flag")
	}
	effective, err := parseEnvFile(envPath)
	if err != nil {
		return fmt.Errorf("read agent env: %w", err)
	}
	for key, value := range updates {
		if value == nil {
			delete(effective, key)
			continue
		}
		effective[key] = *value
	}
	if err := validateEffectiveAuthorship(effective); err != nil {
		return err
	}

	data, err := os.ReadFile(envPath)
	if err != nil {
		return fmt.Errorf("read agent env: %w", err)
	}
	content := strings.ReplaceAll(string(data), "\r\n", "\n")
	hadTrailingNewline := strings.HasSuffix(content, "\n")
	lines := strings.Split(strings.TrimSuffix(content, "\n"), "\n")
	seen := map[string]bool{}
	out := make([]string, 0, len(lines)+len(updates))
	for _, line := range lines {
		match := envAssignmentPattern.FindStringSubmatch(line)
		if len(match) != 2 {
			out = append(out, line)
			continue
		}
		key := match[1]
		value, managed := updates[key]
		if !managed {
			out = append(out, line)
			continue
		}
		if seen[key] {
			continue
		}
		seen[key] = true
		if value != nil {
			out = append(out, key+"="+shellSingleQuote(*value))
		}
	}

	keys := make([]string, 0, len(updates))
	for key := range updates {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	for _, key := range keys {
		if seen[key] || updates[key] == nil {
			continue
		}
		out = append(out, key+"="+shellSingleQuote(*updates[key]))
	}
	result := strings.Join(out, "\n")
	if hadTrailingNewline || result != "" {
		result += "\n"
	}
	if err := writeFileAtomic(envPath, []byte(result), ".moltnet-env-*"); err != nil {
		return fmt.Errorf("write agent env: %w", err)
	}

	changedKeys := make([]string, 0, len(updates))
	for key := range updates {
		changedKeys = append(changedKeys, key)
	}
	sort.Strings(changedKeys)
	fmt.Fprintf(cmd.OutOrStdout(), "Updated %s: %s\n", agentName, strings.Join(changedKeys, ", "))
	return nil
}

func validateEffectiveAuthorship(env map[string]string) error {
	mode := strings.TrimSpace(env["MOLTNET_COMMIT_AUTHORSHIP"])
	if mode == "" {
		mode = "agent"
	}
	if mode != "agent" && mode != "human" && mode != "coauthor" {
		return fmt.Errorf("resulting authorship must be agent, human, or coauthor")
	}
	humanIdentity := strings.TrimSpace(env["MOLTNET_HUMAN_GIT_IDENTITY"])
	if humanIdentity != "" && !isValidGitIdentity(humanIdentity) {
		return fmt.Errorf("resulting human git identity must use Name <email> format")
	}
	if (mode == "human" || mode == "coauthor") && humanIdentity == "" {
		return fmt.Errorf("%s authorship requires --human-git-identity", mode)
	}
	return nil
}

func shellSingleQuote(value string) string {
	return "'" + strings.ReplaceAll(value, "'", `'\''`) + "'"
}
