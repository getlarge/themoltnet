package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
)

func staticGuardContext(mode string) githubGuardContext {
	return githubGuardContext{
		CredentialsPath: "/repo/.moltnet/test-agent/moltnet.json",
		AuthorshipMode:  mode,
	}
}

func guardPermissions(values map[string]string) guardPermissionLoader {
	return func(context.Context, string) (map[string]string, error) {
		return values, nil
	}
}

func TestEvaluateGitHubGuard_ReadOnlyCommandsAllow(t *testing.T) {
	t.Parallel()
	commands := []string{
		"gh pr view 1615",
		"gh issue list --limit 10",
		"gh api repos/getlarge/themoltnet",
		"gh api --method GET -f page=2 repos/getlarge/themoltnet/issues",
		"gh api graphql -f 'query=query Viewer { viewer { login } }'",
		"gh repo clone getlarge/themoltnet",
		"gh workflow view ci.yml",
		"gh auth status",
		"echo 'gh pr create --title not-a-command'",
	}
	for _, command := range commands {
		t.Run(command, func(t *testing.T) {
			reason := evaluateGitHubGuard(command, staticGuardContext("agent"), guardPermissions(map[string]string{"pull_requests": "write"}))
			if reason != "" {
				t.Fatalf("expected allow, got denial: %s", reason)
			}
		})
	}
}

func TestEvaluateGitHubGuard_SupportedBareWriteDenies(t *testing.T) {
	t.Parallel()
	reason := evaluateGitHubGuard(
		"gh pr create --title test",
		staticGuardContext("agent"),
		guardPermissions(map[string]string{"pull_requests": "write"}),
	)
	if !strings.Contains(reason, "pull_requests:write") || !strings.Contains(reason, "moltnet github token") {
		t.Fatalf("unexpected denial reason: %q", reason)
	}
}

func TestEvaluateGitHubGuard_MissingPermissionAllowsUserFallback(t *testing.T) {
	t.Parallel()
	reason := evaluateGitHubGuard(
		"gh workflow run ci.yml",
		staticGuardContext("agent"),
		guardPermissions(map[string]string{
			"contents":      "write",
			"issues":        "write",
			"pull_requests": "write",
		}),
	)
	if reason != "" {
		t.Fatalf("expected user-token fallback, got denial: %s", reason)
	}
}

func TestEvaluateGitHubGuard_PermissionLookupFailureAllowsSilently(t *testing.T) {
	t.Parallel()
	reason := evaluateGitHubGuard(
		"gh issue close 1615",
		staticGuardContext("agent"),
		func(context.Context, string) (map[string]string, error) {
			return nil, errors.New("offline")
		},
	)
	if reason != "" {
		t.Fatalf("expected fail-open allow, got denial: %s", reason)
	}
}

func TestEvaluateGitHubGuard_CommandScopedMoltnetTokensAllow(t *testing.T) {
	t.Parallel()
	commands := []string{
		`GH_TOKEN=$(moltnet github token --credentials /repo/.moltnet/a/moltnet.json) gh issue close 1615`,
		`GH_TOKEN="$(npx @themoltnet/cli github token --credentials /repo/.moltnet/a/moltnet.json)" command gh pr merge 42`,
		`env GH_TOKEN=$(moltnet github token) /usr/local/bin/gh api --method DELETE repos/o/r/issues/1`,
	}
	for _, command := range commands {
		t.Run(command, func(t *testing.T) {
			reason := evaluateGitHubGuard(command, staticGuardContext("agent"), guardPermissions(map[string]string{"issues": "write", "pull_requests": "write"}))
			if reason != "" {
				t.Fatalf("expected scoped token to allow, got denial: %s", reason)
			}
		})
	}
}

func TestEvaluateGitHubGuard_TokenScopeDoesNotLeakAcrossChain(t *testing.T) {
	t.Parallel()
	reason := evaluateGitHubGuard(
		`GH_TOKEN=$(moltnet github token) gh issue edit 1 --title first && gh issue edit 2 --title second`,
		staticGuardContext("agent"),
		guardPermissions(map[string]string{"issues": "write"}),
	)
	if reason == "" {
		t.Fatal("expected the second bare write to be denied")
	}
}

func TestEvaluateGitHubGuard_QuotedExecutableAndSeparators(t *testing.T) {
	t.Parallel()
	reason := evaluateGitHubGuard(
		`printf '%s' 'gh issue close 1'; "gh" issue close 1 | tee /tmp/result`,
		staticGuardContext("agent"),
		guardPermissions(map[string]string{"issues": "write"}),
	)
	if reason == "" {
		t.Fatal("expected quoted gh executable to be denied")
	}
}

func TestEvaluateGitHubGuard_LiteralNestedShells(t *testing.T) {
	t.Parallel()
	permissions := guardPermissions(map[string]string{"issues": "write"})
	for _, command := range []string{
		`sh -c 'gh issue close 1'`,
		`bash -lc 'gh issue close 1'`,
		`eval 'gh issue close 1'`,
	} {
		if reason := evaluateGitHubGuard(command, staticGuardContext("agent"), permissions); reason == "" {
			t.Fatalf("expected nested write to be denied: %s", command)
		}
	}

	for _, command := range []string{
		`sh -c 'echo "gh issue close 1"'`,
		`GH_TOKEN=$(moltnet github token) sh -c 'gh issue close 1'`,
	} {
		if reason := evaluateGitHubGuard(command, staticGuardContext("agent"), permissions); reason != "" {
			t.Fatalf("expected nested command to be allowed: %s: %s", command, reason)
		}
	}
}

func TestEvaluateGitHubGuard_HumanModeAllowsVisibleWritesOnly(t *testing.T) {
	t.Parallel()
	permissions := guardPermissions(map[string]string{
		"issues":        "write",
		"pull_requests": "write",
		"contents":      "write",
	})
	for _, command := range []string{"gh pr comment 1 --body ok", "gh issue create --title ok"} {
		if reason := evaluateGitHubGuard(command, staticGuardContext("human"), permissions); reason != "" {
			t.Fatalf("expected human-visible command to allow: %s", reason)
		}
	}
	if reason := evaluateGitHubGuard("gh api --method PUT repos/o/r/contents/file -f content=x", staticGuardContext("human"), permissions); reason == "" {
		t.Fatal("expected content API write to remain agent-attributed")
	}
}

func TestEvaluateGitHubGuard_APIWriteClassification(t *testing.T) {
	t.Parallel()
	permissions := guardPermissions(map[string]string{
		"contents": "write",
		"issues":   "write",
	})
	tests := []struct {
		name    string
		command string
		deny    bool
	}{
		{name: "implicit post", command: "gh api repos/o/r/issues -f title=test", deny: true},
		{name: "explicit patch", command: "gh api -X PATCH repos/o/r/issues/1 -f title=test", deny: true},
		{name: "explicit get with fields", command: "gh api -X GET repos/o/r/issues -f state=open", deny: false},
		{name: "graphql query", command: `gh api graphql -f 'query=query Repo { viewer { login } }'`, deny: false},
		{name: "graphql shorthand query", command: `gh api graphql -f 'query={ viewer { login } }'`, deny: false},
		{name: "graphql mutation", command: `gh api graphql -f 'query=mutation Add { addComment(input: {}) { clientMutationId } }'`, deny: true},
		{name: "graphql file", command: "gh api graphql -F query=@query.graphql", deny: true},
		{name: "unknown write endpoint", command: "gh api -X POST user/keys -f key=x", deny: true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			reason := evaluateGitHubGuard(tt.command, staticGuardContext("agent"), permissions)
			if (reason != "") != tt.deny {
				t.Fatalf("deny=%v, reason=%q", tt.deny, reason)
			}
		})
	}
}

func TestEvaluateGitHubGuard_UnknownAndDynamicCommandsDeny(t *testing.T) {
	t.Parallel()
	for _, command := range []string{
		"gh future-command mutate",
		"gh extension exec third-party write",
		`gh "$COMMAND"`,
		`GH_TOKEN=$(moltnet github token) gh future-command mutate`,
		`GH_TOKEN=$(moltnet github token) gh api graphql -f 'query=mutation Add { addComment(input: {}) { clientMutationId } }'`,
	} {
		if reason := evaluateGitHubGuard(command, staticGuardContext("agent"), guardPermissions(map[string]string{})); reason == "" {
			t.Fatalf("expected unknown command to deny: %s", command)
		}
	}
}

func TestEvaluateGitHubGuard_MalformedShellAllows(t *testing.T) {
	t.Parallel()
	reason := evaluateGitHubGuard("gh pr create '", staticGuardContext("agent"), guardPermissions(map[string]string{"pull_requests": "write"}))
	if reason != "" {
		t.Fatalf("expected malformed shell to fail open, got: %s", reason)
	}
}

func TestRunGitHubGuard_Contract(t *testing.T) {
	t.Parallel()
	payload := `{"tool_input":{"command":"gh pr create --title test"}}`
	var output bytes.Buffer
	err := runGitHubGuard(
		strings.NewReader(payload),
		&output,
		func() (githubGuardContext, bool) { return staticGuardContext("agent"), true },
		guardPermissions(map[string]string{"pull_requests": "write"}),
	)
	if err != nil {
		t.Fatalf("runGitHubGuard: %v", err)
	}
	var decoded hookDenyOutput
	if err := json.Unmarshal(output.Bytes(), &decoded); err != nil {
		t.Fatalf("decode hook output: %v; output=%q", err, output.String())
	}
	if decoded.HookSpecificOutput.HookEventName != "PreToolUse" || decoded.HookSpecificOutput.PermissionDecision != "deny" {
		t.Fatalf("unexpected hook output: %#v", decoded)
	}
}

func TestRunGitHubGuard_SilentAllows(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name    string
		payload string
		active  bool
	}{
		{name: "malformed json", payload: `{`, active: true},
		{name: "missing command", payload: `{}`, active: true},
		{name: "inactive context", payload: `{"tool_input":{"command":"gh pr create"}}`, active: false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var output bytes.Buffer
			err := runGitHubGuard(
				strings.NewReader(tt.payload),
				&output,
				func() (githubGuardContext, bool) { return staticGuardContext("agent"), tt.active },
				guardPermissions(map[string]string{"pull_requests": "write"}),
			)
			if err != nil || output.Len() != 0 {
				t.Fatalf("expected silent allow, err=%v output=%q", err, output.String())
			}
		})
	}
}

func TestIsMoltnetGitConfig(t *testing.T) {
	t.Parallel()
	for _, path := range []string{
		".moltnet/agent/gitconfig",
		"/repo/.moltnet/agent/gitconfig",
		`C:\repo\.moltnet\agent\gitconfig`,
	} {
		if !isMoltnetGitConfig(path) {
			t.Errorf("expected active path: %q", path)
		}
	}
	for _, path := range []string{"", ".gitconfig", ".moltnet/gitconfig", "/repo/agent/gitconfig"} {
		if isMoltnetGitConfig(path) {
			t.Errorf("expected inactive path: %q", path)
		}
	}
}
