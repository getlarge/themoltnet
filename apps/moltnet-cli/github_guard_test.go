package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
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
		`GH_TOKEN=$(moltnet github token --credentials /repo/.moltnet/test-agent/moltnet.json) gh issue close 1615`,
		`GH_TOKEN="$(npx @themoltnet/cli github token --credentials=/repo/.moltnet/test-agent/moltnet.json)" command gh pr merge 42`,
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

func TestEvaluateGitHubGuard_OtherAgentTokenDoesNotAuthorizeWrite(t *testing.T) {
	t.Parallel()
	reason := evaluateGitHubGuard(
		`GH_TOKEN=$(moltnet github token --credentials /repo/.moltnet/other-agent/moltnet.json) gh pr create`,
		staticGuardContext("agent"),
		guardPermissions(map[string]string{"pull_requests": "write"}),
	)
	if reason == "" {
		t.Fatal("expected a token minted from another agent's credentials to be denied")
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
		`bash --rcfile /dev/null -c 'gh issue close 1'`,
		`bash --norc -c 'gh issue close 1'`,
		`bash --init-file /dev/null -c 'gh issue close 1'`,
		`bash --noprofile -c 'gh issue close 1'`,
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
	if reason := evaluateGitHubGuard("gh pr comment 1 --body ok", staticGuardContext("coauthor"), permissions); reason == "" {
		t.Fatal("expected coauthor mode to retain agent-attributed GitHub writes")
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
		{name: "graphql typed mutation", command: `gh api graphql -F 'query=mutation Add { addComment(input: {}) { clientMutationId } }'`, deny: true},
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

func TestPermissionForRESTEndpoint(t *testing.T) {
	t.Parallel()
	tests := map[string]string{
		"repos/o/r/contents/file": "contents",
		"/repos/o/r/releases/1":   "contents",
		"repos/o/r/issues/1":      "issues",
		"repos/o/r/pulls/1/merge": "pull_requests",
		"repos/o/r/actions/runs":  "actions",
		"repos/o/r":               "",
		"orgs/o/repos":            "",
	}
	for endpoint, want := range tests {
		if got := permissionForRESTEndpoint(endpoint); got != want {
			t.Errorf("permissionForRESTEndpoint(%q) = %q, want %q", endpoint, got, want)
		}
	}
}

func TestEvaluateGitHubGuard_UnknownAndDynamicCommandsDeny(t *testing.T) {
	t.Parallel()
	for _, command := range []string{
		"gh future-command mutate",
		"gh extension exec third-party write",
		`gh "$COMMAND"`,
		`GH_TOKEN=$(moltnet github token) gh future-command mutate`,
	} {
		if reason := evaluateGitHubGuard(command, staticGuardContext("agent"), guardPermissions(map[string]string{})); reason == "" {
			t.Fatalf("expected unknown command to deny: %s", command)
		}
	}
}

func TestEvaluateGitHubGuard_ArgumentValuesCannotBypassWrites(t *testing.T) {
	t.Parallel()
	permissions := guardPermissions(map[string]string{
		"issues":        "write",
		"pull_requests": "write",
	})
	for _, command := range []string{
		`gh pr create --title "-h" --body test`,
		`gh pr merge 1 --subject "-h"`,
		`gh api -X POST repos/o/r/issues --input "-h"`,
		`gh api repos/o/r/issues --jq "-h" -f title=test`,
	} {
		if reason := evaluateGitHubGuard(command, staticGuardContext("agent"), permissions); reason == "" {
			t.Fatalf("expected write to be denied: %s", command)
		}
	}
}

func TestEvaluateGitHubGuard_LeadingRepositoryFlagsCannotBypassWrites(t *testing.T) {
	t.Parallel()
	permissions := guardPermissions(map[string]string{
		"issues":        "write",
		"pull_requests": "write",
		"contents":      "write",
	})
	for _, command := range []string{
		`gh -R o/r pr merge 1`,
		`gh --repo o/r issue close 1`,
		`gh --repo=o/r release delete v1`,
	} {
		if reason := evaluateGitHubGuard(command, staticGuardContext("agent"), permissions); reason == "" {
			t.Fatalf("expected write to be denied: %s", command)
		}
	}
}

func TestEvaluateGitHubGuard_AttachedAPIMethodsCannotBypassWrites(t *testing.T) {
	t.Parallel()
	permissions := guardPermissions(map[string]string{"issues": "write"})
	for _, command := range []string{
		`gh api -XPOST repos/o/r/issues`,
		`gh api -XPATCH repos/o/r/issues/1`,
		`gh api -XDELETE repos/o/r/issues/1`,
	} {
		if reason := evaluateGitHubGuard(command, staticGuardContext("agent"), permissions); reason == "" {
			t.Fatalf("expected API write to be denied: %s", command)
		}
	}
}

func TestEvaluateGitHubGuard_CommandRunnersCannotHideGitHubWrites(t *testing.T) {
	t.Parallel()
	permissions := guardPermissions(map[string]string{
		"issues":        "write",
		"pull_requests": "write",
		"contents":      "write",
	})
	for _, command := range []string{
		`env -S "GH_TOKEN=fake gh pr create"`,
		`env --split-string="gh issue close 1"`,
		`nohup gh pr merge 1`,
		`timeout 10s gh issue close 1`,
		`sudo -u root gh release delete v1`,
		`xargs -n 1 gh issue close`,
	} {
		if reason := evaluateGitHubGuard(command, staticGuardContext("agent"), permissions); reason == "" {
			t.Fatalf("expected wrapped write to be denied: %s", command)
		}
	}
}

func TestEvaluateGitHubGuard_DynamicShellsFailClosed(t *testing.T) {
	t.Parallel()
	permissions := guardPermissions(map[string]string{"pull_requests": "write", "issues": "write"})
	for _, command := range []string{
		`SCRIPT='gh pr merge 1'; bash -c "$SCRIPT"`,
		`COMMAND='gh issue close 1'; eval "$COMMAND"`,
		`timeout "$DURATION" gh pr merge 1`,
	} {
		if reason := evaluateGitHubGuard(command, staticGuardContext("agent"), permissions); reason == "" {
			t.Fatalf("expected dynamic command to be denied: %s", command)
		}
	}
}

func TestEvaluateGitHubGuard_NestingDepthLimitDenies(t *testing.T) {
	t.Parallel()
	reason := evaluateGitHubGuardScript(
		`sh -c 'gh issue close 1'`,
		staticGuardContext("agent"),
		guardPermissions(map[string]string{"issues": "write"}),
		&guardEvaluationState{},
		8,
	)
	if !strings.Contains(reason, "too deep") {
		t.Fatalf("expected recursion-cap denial, got %q", reason)
	}
}

func TestEvaluateGitHubGuard_ScopedTokenAllowsGraphQLMutation(t *testing.T) {
	t.Parallel()
	command := `GH_TOKEN=$(moltnet github token) gh api graphql -f 'query=mutation Add { addComment(input: {}) { clientMutationId } }'`
	if reason := evaluateGitHubGuard(command, staticGuardContext("agent"), guardPermissions(map[string]string{})); reason != "" {
		t.Fatalf("expected scoped GraphQL mutation to be allowed: %s", reason)
	}
}

func TestEvaluateGitHubGuard_NestedScopedTokenIsConsumedByOneWrite(t *testing.T) {
	t.Parallel()
	command := `GH_TOKEN=$(moltnet github token) sh -c 'gh issue close 1; gh pr merge 1'`
	permissions := guardPermissions(map[string]string{})
	if reason := evaluateGitHubGuard(command, staticGuardContext("agent"), permissions); reason == "" {
		t.Fatal("expected a single scoped token assignment not to authorize two writes")
	}
}

func TestEvaluateGitHubGuard_AliasAndConfigWritesAreNotReadOnly(t *testing.T) {
	t.Parallel()
	for _, command := range []string{
		`gh alias set co pr checkout`,
		`gh alias delete co`,
		`gh config set git_protocol ssh`,
		`gh config clear-cache`,
	} {
		if reason := evaluateGitHubGuard(command, staticGuardContext("agent"), guardPermissions(map[string]string{})); reason == "" {
			t.Fatalf("expected write to be denied: %s", command)
		}
	}

	for _, command := range []string{
		`gh alias list`,
		`gh config get git_protocol`,
		`gh config list`,
	} {
		if reason := evaluateGitHubGuard(command, staticGuardContext("agent"), guardPermissions(map[string]string{})); reason != "" {
			t.Fatalf("expected read to be allowed: %s: %s", command, reason)
		}
	}
}

func TestEvaluateGitHubGuard_StrictModeDeniesPermissionLookupFailures(t *testing.T) {
	t.Parallel()
	guardCtx := staticGuardContext("agent")
	guardCtx.Strict = true
	reason := evaluateGitHubGuard(
		`gh issue close 1`,
		guardCtx,
		func(context.Context, string) (map[string]string, error) {
			return nil, errors.New("offline")
		},
	)
	if reason == "" {
		t.Fatal("expected strict mode to deny when permissions cannot be loaded")
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

func TestRunGitHubGuard_DisabledByEnvironment(t *testing.T) {
	t.Setenv("MOLTNET_GITHUB_GUARD", "off")
	var output bytes.Buffer
	err := runGitHubGuard(
		strings.NewReader(`{"tool_input":{"command":"gh pr create --title test"}}`),
		&output,
		func() (githubGuardContext, bool) { return staticGuardContext("agent"), true },
		guardPermissions(map[string]string{"pull_requests": "write"}),
	)
	if err != nil || output.Len() != 0 {
		t.Fatalf("expected disabled guard to allow silently, err=%v output=%q", err, output.String())
	}
}

func TestCurrentGitHubGuardContext_AbsoluteConfigAndEnvironment(t *testing.T) {
	agentDir := filepath.Join(t.TempDir(), ".moltnet", "agent")
	t.Setenv("GIT_CONFIG_GLOBAL", filepath.Join(agentDir, "gitconfig"))
	t.Setenv("MOLTNET_COMMIT_AUTHORSHIP", "human")
	t.Setenv("MOLTNET_GITHUB_GUARD_STRICT", "true")

	guardCtx, ok := currentGitHubGuardContext()

	if !ok {
		t.Fatal("expected an absolute MoltNet git config to activate the guard")
	}
	if guardCtx.AuthorshipMode != "human" || !guardCtx.Strict {
		t.Fatalf("unexpected context: %#v", guardCtx)
	}
	if want := filepath.Join(agentDir, "moltnet.json"); guardCtx.CredentialsPath != want {
		t.Fatalf("credentials path = %q, want %q", guardCtx.CredentialsPath, want)
	}
}

func TestCurrentGitHubGuardContext_RelativeConfigReadsAgentEnv(t *testing.T) {
	repoDir := t.TempDir()
	if output, err := exec.Command("git", "init", repoDir).CombinedOutput(); err != nil {
		t.Fatalf("git init: %v: %s", err, output)
	}
	agentDir := filepath.Join(repoDir, ".moltnet", "agent")
	if err := os.MkdirAll(agentDir, 0o700); err != nil {
		t.Fatalf("create agent dir: %v", err)
	}
	if err := os.WriteFile(
		filepath.Join(agentDir, "env"),
		[]byte("MOLTNET_COMMIT_AUTHORSHIP=human\n"),
		0o600,
	); err != nil {
		t.Fatalf("write agent env: %v", err)
	}

	previousDir, err := os.Getwd()
	if err != nil {
		t.Fatalf("get working directory: %v", err)
	}
	if err := os.Chdir(repoDir); err != nil {
		t.Fatalf("change directory: %v", err)
	}
	t.Cleanup(func() {
		if err := os.Chdir(previousDir); err != nil {
			t.Errorf("restore working directory: %v", err)
		}
	})
	t.Setenv("GIT_CONFIG_GLOBAL", ".moltnet/agent/gitconfig")
	t.Setenv("MOLTNET_COMMIT_AUTHORSHIP", "")

	guardCtx, ok := currentGitHubGuardContext()

	if !ok {
		t.Fatal("expected a relative MoltNet git config inside a repository to activate the guard")
	}
	if guardCtx.AuthorshipMode != "human" {
		t.Fatalf("authorship mode = %q, want human", guardCtx.AuthorshipMode)
	}
	resolvedRepoDir, err := filepath.EvalSymlinks(repoDir)
	if err != nil {
		t.Fatalf("resolve repository path: %v", err)
	}
	if want := filepath.Join(resolvedRepoDir, ".moltnet", "agent", "moltnet.json"); guardCtx.CredentialsPath != want {
		t.Fatalf("credentials path = %q, want %q", guardCtx.CredentialsPath, want)
	}
}

func TestCurrentGitHubGuardContext_RelativeConfigOutsideRepositoryIsInactive(t *testing.T) {
	previousDir, err := os.Getwd()
	if err != nil {
		t.Fatalf("get working directory: %v", err)
	}
	if err := os.Chdir(t.TempDir()); err != nil {
		t.Fatalf("change directory: %v", err)
	}
	t.Cleanup(func() {
		if err := os.Chdir(previousDir); err != nil {
			t.Errorf("restore working directory: %v", err)
		}
	})
	t.Setenv("GIT_CONFIG_GLOBAL", ".moltnet/agent/gitconfig")

	if guardCtx, ok := currentGitHubGuardContext(); ok {
		t.Fatalf("expected inactive context outside a repository, got %#v", guardCtx)
	}
}

func TestGitHubGuardCobraPath(t *testing.T) {
	agentDir := filepath.Join(t.TempDir(), ".moltnet", "agent")
	t.Setenv("GIT_CONFIG_GLOBAL", filepath.Join(agentDir, "gitconfig"))
	root := NewRootCmd("test", "")
	root.SetIn(strings.NewReader(
		`{"tool_input":{"command":"gh future-command mutate"}}`,
	))

	stdout, _, err := executeCommand(root, "github", "guard")

	if err != nil {
		t.Fatalf("execute guard command: %v", err)
	}
	var decoded hookDenyOutput
	if err := json.Unmarshal([]byte(stdout), &decoded); err != nil {
		t.Fatalf("decode guard output: %v; output=%q", err, stdout)
	}
	if decoded.HookSpecificOutput.PermissionDecision != "deny" {
		t.Fatalf("unexpected guard output: %#v", decoded)
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
