package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"mvdan.cc/sh/v3/syntax"
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
	agentDir := setupGitHubGuardIdentity(t)
	t.Setenv("MOLTNET_COMMIT_AUTHORSHIP", "human")
	t.Setenv("MOLTNET_GITHUB_GUARD_STRICT", "true")

	guardCtx, ok := currentGitHubGuardContext()

	if !ok {
		t.Fatal("expected the selected central identity to activate the guard")
	}
	if guardCtx.AuthorshipMode != "human" || !guardCtx.Strict {
		t.Fatalf("unexpected context: %#v", guardCtx)
	}
	if want := filepath.Join(agentDir, "moltnet.json"); guardCtx.CredentialsPath != want {
		t.Fatalf("credentials path = %q, want %q", guardCtx.CredentialsPath, want)
	}
}

func TestCurrentGitHubGuardContext_RelativeConfigReadsAgentEnv(t *testing.T) {
	agentDir := setupGitHubGuardIdentity(t)
	if err := os.WriteFile(
		filepath.Join(agentDir, "env"),
		[]byte("MOLTNET_COMMIT_AUTHORSHIP=human\n"),
		0o600,
	); err != nil {
		t.Fatalf("write agent env: %v", err)
	}

	t.Setenv("MOLTNET_COMMIT_AUTHORSHIP", "")

	guardCtx, ok := currentGitHubGuardContext()

	if !ok {
		t.Fatal("expected a selected central identity to activate the guard")
	}
	if guardCtx.AuthorshipMode != "human" {
		t.Fatalf("authorship mode = %q, want human", guardCtx.AuthorshipMode)
	}
	if want := filepath.Join(agentDir, "moltnet.json"); guardCtx.CredentialsPath != want {
		t.Fatalf("credentials path = %q, want %q", guardCtx.CredentialsPath, want)
	}
}

func TestCurrentGitHubGuardContext_RelativeConfigOutsideRepositoryIsInactive(t *testing.T) {
	t.Setenv("HOME", t.TempDir())

	if guardCtx, ok := currentGitHubGuardContext(); ok {
		t.Fatalf("expected inactive context outside a repository, got %#v", guardCtx)
	}
}

func TestGitHubGuardCobraPath(t *testing.T) {
	setupGitHubGuardIdentity(t)
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

func setupGitHubGuardIdentity(t *testing.T) string {
	t.Helper()
	home := t.TempDir()
	t.Setenv("HOME", home)
	agentDir := filepath.Join(home, ".config", "moltnet", "identities", "agent")
	if err := os.MkdirAll(agentDir, 0o700); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"moltnet.json", "gitconfig"} {
		if err := os.WriteFile(filepath.Join(agentDir, name), []byte("{}\n"), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(filepath.Join(agentDir, "env"), []byte("MOLTNET_COMMIT_AUTHORSHIP=human\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := writeIdentitySelector("agent"); err != nil {
		t.Fatal(err)
	}
	return agentDir
}

func TestEvaluateGitHubGuard_StaticVariablesResolveScopedWrites(t *testing.T) {
	t.Parallel()
	// Every command assigns its credentials/endpoint/payload/body through shell
	// variables with statically determinable values, then performs a scoped gh
	// write. These are the natural agent forms that issue #1697 unblocks — most
	// importantly submitting a line-anchored PR review via the reviews endpoint.
	permissions := guardPermissions(map[string]string{
		"issues":        "write",
		"pull_requests": "write",
		"contents":      "write",
	})
	commands := []string{
		// Scoped token credentials path supplied via $CREDS.
		`CREDS=/repo/.moltnet/test-agent/moltnet.json; GH_TOKEN=$(moltnet github token --credentials "$CREDS") gh api --method POST repos/o/r/pulls/1/reviews --input /tmp/review.json`,
		// Both the token creds and the --input payload path via variables, plus --jq.
		`CREDS=/repo/.moltnet/test-agent/moltnet.json; JSON=/tmp/review.json; GH_TOKEN=$(moltnet github token --credentials "$CREDS") gh api --method POST repos/o/r/pulls/1/reviews --input "$JSON" --jq .html_url`,
		// Endpoint itself supplied via a resolved variable.
		`EP=repos/o/r/pulls/1/reviews; GH_TOKEN=$(moltnet github token --credentials /repo/.moltnet/test-agent/moltnet.json) gh api --method POST "$EP" --input /tmp/review.json`,
		// Chained variable resolution for the credentials path.
		`ROOT=/repo/.moltnet; CREDS="$ROOT/test-agent/moltnet.json"; GH_TOKEN=$(moltnet github token --credentials "$CREDS") gh pr comment 1 --body ok`,
		// Body supplied via a variable on a pr review.
		`BODY=looks-good; GH_TOKEN=$(moltnet github token --credentials /repo/.moltnet/test-agent/moltnet.json) gh pr review 1 --comment --body "$BODY"`,
		// ${NAME} brace form for the credentials path.
		`CREDS=/repo/.moltnet/test-agent/moltnet.json; GH_TOKEN=$(moltnet github token --credentials "${CREDS}") gh issue create --title t --body b`,
	}
	for _, command := range commands {
		t.Run(command, func(t *testing.T) {
			if reason := evaluateGitHubGuard(command, staticGuardContext("agent"), permissions); reason != "" {
				t.Fatalf("expected variable-resolved scoped write to allow, got denial: %s", reason)
			}
		})
	}
}

func TestEvaluateGitHubGuard_UnresolvableVariablesStayClosed(t *testing.T) {
	t.Parallel()
	// Resolution never weakens the guard: a variable it cannot statically pin
	// stays opaque, so the write is denied exactly as before the fix.
	permissions := guardPermissions(map[string]string{
		"issues":        "write",
		"pull_requests": "write",
		"contents":      "write",
	})
	commands := []string{
		// Credentials path resolves to a *different* agent — must not authorize.
		`CREDS=/repo/.moltnet/other-agent/moltnet.json; GH_TOKEN=$(moltnet github token --credentials "$CREDS") gh pr create`,
		// $CREDS is never assigned in the script.
		`GH_TOKEN=$(moltnet github token --credentials "$CREDS") gh pr create`,
		// Multiply-assigned name is poisoned to opaque (models a conditional
		// reassignment such as the case-esac in the canonical token snippet).
		`CREDS=/repo/.moltnet/test-agent/moltnet.json; CREDS=/tmp/evil; GH_TOKEN=$(moltnet github token --credentials "$CREDS") gh pr create`,
		// Command-substitution-derived value (e.g. $(dirname …)) never resolves.
		`CREDS="$(dirname /repo/.moltnet/test-agent/gitconfig)/moltnet.json"; GH_TOKEN=$(moltnet github token --credentials "$CREDS") gh pr create`,
		// Conditional reassignment inside case-esac: CFG assigned twice → opaque,
		// so the documented $(dirname "$CFG") snippet remains unverifiable.
		`CFG=/repo/.moltnet/test-agent/gitconfig; case "$CFG" in /*) ;; *) CFG=/other ;; esac; CREDS="$CFG"; GH_TOKEN=$(moltnet github token --credentials "$CREDS") gh pr create`,
		// Endpoint via an unresolved variable stays unmappable (ghUnknown).
		`GH_TOKEN=$(moltnet github token --credentials /repo/.moltnet/test-agent/moltnet.json) gh api --method POST "$ENDPOINT" --input /tmp/x.json`,
		// Operator expansion (${x:-default}) is not statically substituted.
		`GH_TOKEN=$(moltnet github token --credentials "${CREDS:-/repo/.moltnet/test-agent/moltnet.json}") gh pr create`,
	}
	for _, command := range commands {
		t.Run(command, func(t *testing.T) {
			if reason := evaluateGitHubGuard(command, staticGuardContext("agent"), permissions); reason == "" {
				t.Fatalf("expected unresolved variable to deny: %s", command)
			}
		})
	}
}

func TestCollectStaticShellVars(t *testing.T) {
	t.Parallel()
	parse := func(command string) map[string]string {
		file, err := syntax.NewParser(syntax.Variant(syntax.LangBash)).Parse(strings.NewReader(command), "hook")
		if err != nil {
			t.Fatalf("parse %q: %v", command, err)
		}
		return collectStaticShellVars(file)
	}

	got := parse(`ROOT=/repo/.moltnet; CREDS="$ROOT/test-agent/moltnet.json"; NAME='x'`)
	want := map[string]string{
		"ROOT":  "/repo/.moltnet",
		"CREDS": "/repo/.moltnet/test-agent/moltnet.json",
		"NAME":  "x",
	}
	for name, value := range want {
		if got[name] != value {
			t.Errorf("var %q = %q, want %q", name, got[name], value)
		}
	}

	for name, command := range map[string]string{
		"command substitution": `CREDS="$(dirname /x)/y"`,
		"reassigned":           `CREDS=/a; CREDS=/b`,
		"appended":             `CREDS=/a; CREDS+=/b`,
		"nested only":          `if true; then CREDS=/a; fi`,
		"operator expansion":   `CREDS="${OTHER:-/a}"`,
	} {
		if _, ok := parse(command)["CREDS"]; ok {
			t.Errorf("%s: expected CREDS to stay opaque for %q", name, command)
		}
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

// --- Issue #1824: canonical GitHub guard write path ---

func TestEvaluateGitHubGuard_MoltnetGitHubExecAllowsWrite(t *testing.T) {
	t.Parallel()
	commands := []string{
		`moltnet github exec -- gh issue edit 1788 --body-file issue.md`,
		`moltnet github exec -- gh pr create --title "Fix" --body "Description"`,
		`moltnet github exec -- gh issue close 42`,
		`npx @themoltnet/cli github exec -- gh pr merge 10`,
	}
	for _, command := range commands {
		reason := evaluateGitHubGuard(command, staticGuardContext("agent"), guardPermissions(map[string]string{"issues": "write", "pull_requests": "write"}))
		if reason != "" {
			t.Errorf("expected allow for exec wrapper %q, got denial: %s", command, reason)
		}
	}
}

func TestEvaluateGitHubGuard_MoltnetGitHubExecReadOnlyAllows(t *testing.T) {
	t.Parallel()
	reason := evaluateGitHubGuard(
		`moltnet github exec -- gh pr view 1615`,
		staticGuardContext("agent"),
		guardPermissions(map[string]string{"pull_requests": "write"}),
	)
	if reason != "" {
		t.Fatalf("expected allow for read-only via exec, got denial: %s", reason)
	}
}

func TestEvaluateGitHubGuard_MoltnetGitHubExecDynamicSubcommandDenies(t *testing.T) {
	t.Parallel()
	reason := evaluateGitHubGuard(
		`moltnet github exec -- gh "$CMD" 42`,
		staticGuardContext("agent"),
		guardPermissions(map[string]string{"issues": "write"}),
	)
	if reason == "" {
		t.Fatal("expected denial for dynamic subcommand via exec")
	}
}

func TestEvaluateGitHubGuard_OpaquePayloadKeepsKnownOperation(t *testing.T) {
	t.Parallel()
	// gh issue edit with a dynamic --body value should still be classified as
	// issues:write, not ghUnknown (issue #1824).
	reason := evaluateGitHubGuard(
		`GH_TOKEN=$(moltnet github token --credentials "/repo/.moltnet/test-agent/moltnet.json") gh issue edit 1789 --body "$CURRENT_BODY"`,
		staticGuardContext("agent"),
		guardPermissions(map[string]string{"issues": "write"}),
	)
	if reason != "" {
		t.Fatalf("expected allow for known write with opaque payload, got denial: %s", reason)
	}
}

func TestEvaluateGitHubGuard_OpaqueSubcommandDenies(t *testing.T) {
	t.Parallel()
	// gh "$CMD" — the subcommand itself is opaque → ghUnknown.
	reason := evaluateGitHubGuard(
		`GH_TOKEN=$(moltnet github token --credentials "/repo/.moltnet/test-agent/moltnet.json") gh "$CMD" 42`,
		staticGuardContext("agent"),
		guardPermissions(map[string]string{"issues": "write"}),
	)
	if reason == "" {
		t.Fatal("expected denial for opaque subcommand")
	}
}

func TestEvaluateGitHubGuard_BareWriteWithOpaquePayloadStillDenies(t *testing.T) {
	t.Parallel()
	// Without a scoped token, a bare write with opaque payload should still
	// deny (the App holds the permission).
	reason := evaluateGitHubGuard(
		`gh issue edit 1789 --body "$CURRENT_BODY"`,
		staticGuardContext("agent"),
		guardPermissions(map[string]string{"issues": "write"}),
	)
	if reason == "" {
		t.Fatal("expected denial for bare write with opaque payload when App has permission")
	}
	if !strings.Contains(reason, "issues:write") {
		t.Fatalf("expected issues:write in denial, got: %s", reason)
	}
}
