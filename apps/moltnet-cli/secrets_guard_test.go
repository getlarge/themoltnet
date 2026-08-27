package main

import (
	"bytes"
	"encoding/json"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

func testSecretGuardPathContext(t *testing.T) secretGuardPathContext {
	t.Helper()
	repoRoot, err := filepath.Abs(filepath.Join("..", ".."))
	if err != nil {
		t.Fatal(err)
	}
	return newSecretGuardPathContext(repoRoot, repoRoot, repoRoot)
}

func TestSecretsGuardDeniesCredentialReaders(t *testing.T) {
	t.Parallel()
	readers := []string{"cat", "sed -n 1p", "rg secret", "grep secret", "head", "tail", "awk '{print}'", "jq .", "strings", "xxd", "base64", "ls"}
	for _, reader := range readers {
		reader := reader
		t.Run(reader, func(t *testing.T) {
			command := reader + " .moltnet/agent/moltnet.json"
			if reason := evaluateSecretsShellWithContext(command, testSecretGuardPathContext(t)); reason == "" {
				t.Fatalf("expected denial for %q", command)
			}
		})
	}
}

func TestSecretsGuardDeniesAlternateShellConstructs(t *testing.T) {
	t.Parallel()
	commands := []string{
		`P=.moltnet/agent/env; cat "$P"`,
		`cat ".moltnet/$AGENT/env"`,
		`cat < .moltnet/agent/env`,
		`x=$(cat .moltnet/agent/moltnet.json)`,
		`cat .moltnet/agent/env | base64`,
		`bash -c 'cat .moltnet/agent/env'`,
		`find .moltnet -type f -print`,
		`security find-generic-password -w -s themolt.net`,
		`secret-tool lookup service themolt.net`,
		`moltnet config export-env --credentials .moltnet/agent/moltnet.json --show-secret`,
		`moltnet github token --credentials .moltnet/agent/moltnet.json`,
		`moltnet github credential-helper`,
		`moltnet github credential-helper --credentials .moltnet/agent/moltnet.json`,
		`moltnet ssh-key --output-dir /tmp/exported-agent-key`,
		`"$READER" .moltnet/agent/env`,
		`moltnet agents credentials rotate --credentials .moltnet/agent/moltnet.json`,
		`moltnet agents keys create --team-id team --agent-id agent`,
		`moltnet agents keys rotate key --team-id team`,
		`moltnet register --name leaked-agent`,
		`moltnet --api-url https://api.themolt.net config export-env`,
		`npx --yes @themoltnet/cli config export-env`,
		`moltnet profile create --from-file .moltnet/agent/env --credentials .moltnet/agent/moltnet.json`,
		`moltnet task artifacts upload task --file .moltnet/agent/env --credentials .moltnet/agent/moltnet.json`,
		`GH_TOKEN=$(moltnet github token --credentials .moltnet/agent/moltnet.json) gh pr view 1; moltnet github token --credentials .moltnet/agent/moltnet.json`,
	}
	for _, command := range commands {
		if reason := evaluateSecretsShellWithContext(command, testSecretGuardPathContext(t)); reason == "" {
			t.Errorf("expected denial for %q", command)
		}
	}
}

func TestSecretsGuardDeniesNativeOpenCodeFilePayloads(t *testing.T) {
	t.Parallel()
	payloads := []map[string]any{
		{"tool_name": "read", "tool_input": map[string]any{"filePath": ".moltnet/agent/env"}},
		{"tool_name": "edit", "tool_input": map[string]any{"filePath": ".moltnet/agent/moltnet.json", "oldString": "old", "newString": "new"}},
		{"tool_name": "apply_patch", "tool_input": map[string]any{"patchText": "*** Begin Patch\n*** Update File: .moltnet/agent/env\n@@\n-old\n+new\n*** End Patch"}},
	}
	for _, payload := range payloads {
		encoded, err := json.Marshal(payload)
		if err != nil {
			t.Fatal(err)
		}
		var output bytes.Buffer
		if err := runActiveSecretsGuardCmd(bytes.NewReader(encoded), &output); err != nil {
			t.Fatal(err)
		}
		if !strings.Contains(output.String(), `"permissionDecision":"deny"`) {
			t.Fatalf("expected OpenCode payload denial, got %s", output.String())
		}
	}
}

func TestSecretsGuardDeniesAdversarialShellPayloadsEndToEnd(t *testing.T) {
	t.Parallel()
	commands := []string{
		`"$READER" .moltnet/agent/env`,
		`bash -c '"$READER" .moltnet/agent/moltnet.json'`,
	}
	for _, command := range commands {
		input := secretHookInput{
			ToolName:  "Bash",
			ToolInput: map[string]any{"command": command},
		}
		payload, err := json.Marshal(input)
		if err != nil {
			t.Fatal(err)
		}
		var output bytes.Buffer
		if err := runActiveSecretsGuardCmd(bytes.NewReader(payload), &output); err != nil {
			t.Fatal(err)
		}
		if !strings.Contains(output.String(), `"permissionDecision":"deny"`) {
			t.Fatalf("expected shell payload denial for %q, got %s", command, output.String())
		}
	}
}

func TestSecretsGuardAllowsPatchWhoseContentOnlyMentionsSecretPath(t *testing.T) {
	t.Parallel()
	input := secretHookInput{
		ToolName: "apply_patch",
		ToolInput: map[string]any{
			"patchText": "*** Begin Patch\n*** Update File: docs/security.md\n@@\n-old\n+Never read .moltnet/agent/env directly.\n*** End Patch",
		},
	}
	payload, err := json.Marshal(input)
	if err != nil {
		t.Fatal(err)
	}
	var output bytes.Buffer
	if err := runActiveSecretsGuardCmd(bytes.NewReader(payload), &output); err != nil {
		t.Fatal(err)
	}
	if output.Len() != 0 {
		t.Fatalf("safe patch was denied: %s", output.String())
	}
}

func TestSecretsGuardAllowsSafeOperations(t *testing.T) {
	t.Parallel()
	commands := []string{
		`stat .moltnet/agent/moltnet.json`,
		`test -f .moltnet/agent/moltnet.json`,
		`cat apps/moltnet-cli/main.go`,
		`moltnet agents activation validate --agent agent --credentials .moltnet/agent/moltnet.json`,
		`moltnet env check --agent agent`,
		`moltnet entry list --credentials .moltnet/agent/moltnet.json`,
		`moltnet teams delete team --credentials .moltnet/agent/moltnet.json`,
		`moltnet task artifacts upload task --file report.md --credentials .moltnet/agent/moltnet.json`,
		`moltnet signing-requests list --credentials=.moltnet/agent/moltnet.json`,
		`GH_TOKEN=$(moltnet github token --credentials .moltnet/agent/moltnet.json) gh pr view 1`,
	}
	for _, command := range commands {
		if reason := evaluateSecretsShellWithContext(command, testSecretGuardPathContext(t)); reason != "" {
			t.Errorf("unexpected denial for %q: %s", command, reason)
		}
	}
}

func TestSecretsGuardDirectFileTools(t *testing.T) {
	t.Parallel()
	pathContext := testSecretGuardPathContext(t)
	input := secretHookInput{
		ToolName: "Read",
		ToolInput: map[string]any{
			"file_path": filepath.Join(pathContext.currentRoot, ".moltnet", "agent", "env"),
		},
	}
	payload, _ := json.Marshal(input)
	var output bytes.Buffer
	if err := runActiveSecretsGuardCmd(bytes.NewReader(payload), &output); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(output.String(), `"permissionDecision":"deny"`) {
		t.Fatalf("expected deny output, got %s", output.String())
	}
}

func TestSecretsGuardProtectsManagedHookConfiguration(t *testing.T) {
	t.Parallel()
	pathContext := testSecretGuardPathContext(t)
	paths := []string{
		filepath.Join(pathContext.currentRoot, ".claude", "settings.json"),
		filepath.Join(pathContext.currentRoot, ".claude", "hooks", "moltnet-secret-guard.sh"),
		filepath.Join(pathContext.currentRoot, ".codex", "hooks.json"),
		filepath.Join(pathContext.currentRoot, ".opencode", "plugins", "moltnet-secret-guard.ts"),
	}
	for _, path := range paths {
		input := secretHookInput{ToolName: "Write", ToolInput: map[string]any{"filePath": path}}
		payload, err := json.Marshal(input)
		if err != nil {
			t.Fatal(err)
		}
		var output bytes.Buffer
		if err := runActiveSecretsGuardCmd(bytes.NewReader(payload), &output); err != nil {
			t.Fatal(err)
		}
		if !strings.Contains(output.String(), `"permissionDecision":"deny"`) {
			t.Errorf("expected managed path denial for %s, got %s", path, output.String())
		}
	}
}

func TestSecretsGuardProtectsManagedHookAncestorsAndCaseVariants(t *testing.T) {
	t.Parallel()
	paths := []string{
		".claude",
		".CLAUDE/settings.json",
		".codex",
		".CODEX/hooks.json",
		".opencode",
		".opencode/plugins",
		".OPENCODE/PLUGINS/moltnet-secret-guard.ts",
		".MOLTNET/agent/env",
	}
	for _, path := range paths {
		if !pathTouchesProtectedSecret(path, testSecretGuardPathContext(t)) {
			t.Errorf("expected protected path for %s", path)
		}
	}
}

func TestSecretsGuardResolvesGlobsAndSymlinks(t *testing.T) {
	t.Parallel()
	root := t.TempDir()
	agentDir := filepath.Join(root, ".moltnet", "agent")
	sshDir := filepath.Join(agentDir, "ssh")
	if err := os.MkdirAll(sshDir, 0o700); err != nil {
		t.Fatal(err)
	}
	secretPath := filepath.Join(agentDir, "moltnet.json")
	if err := os.WriteFile(secretPath, []byte("secret"), 0o600); err != nil {
		t.Fatal(err)
	}
	publicLink := filepath.Join(sshDir, "id_ed25519.pub")
	if err := os.Symlink(filepath.Join("..", "moltnet.json"), publicLink); err != nil {
		t.Fatal(err)
	}
	pathContext := newSecretGuardPathContext(root, root, root)

	if !pathTouchesProtectedSecret(filepath.Join(root, ".molt?et", "agent", "moltnet.json"), pathContext) {
		t.Error("expected glob resolving into .moltnet to be protected")
	}
	if !pathTouchesProtectedSecret(publicLink, pathContext) {
		t.Error("expected canonical public-key symlink to a secret to be protected")
	}
	if pathTouchesProtectedSecret(filepath.Join(agentDir, "ssh", "other.pub"), pathContext) == false {
		// Non-canonical .pub names are protected even when they do not yet exist.
		t.Error("expected non-canonical .pub path to be protected")
	}
}

func TestSecretsGuardMalformedInputFailsClosed(t *testing.T) {
	t.Parallel()
	var output bytes.Buffer
	if err := runActiveSecretsGuardCmd(strings.NewReader("{"), &output); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(output.String(), `"permissionDecision":"deny"`) {
		t.Fatalf("expected deny output, got %s", output.String())
	}
}

func TestSecretsGuardInactiveContextNoOpsBeforeParsing(t *testing.T) {
	for _, configured := range []string{
		"",
		"/tmp/unrelated/gitconfig",
		"/tmp/.moltnet/team/agent/gitconfig",
	} {
		t.Run(configured, func(t *testing.T) {
			t.Setenv("GIT_CONFIG_GLOBAL", configured)
			var output bytes.Buffer
			if err := runSecretsGuardCmd(strings.NewReader("{"), &output); err != nil {
				t.Fatal(err)
			}
			if output.Len() != 0 {
				t.Fatalf("inactive guard emitted output: %s", output.String())
			}
		})
	}
}

func TestSecretsGuardActivatedContextStillFailsClosed(t *testing.T) {
	agentDir := filepath.Join(t.TempDir(), ".moltnet", "agent")
	t.Setenv("GIT_CONFIG_GLOBAL", filepath.Join(agentDir, "gitconfig"))
	var output bytes.Buffer
	if err := runSecretsGuardCmd(strings.NewReader("{"), &output); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(output.String(), `"permissionDecision":"deny"`) {
		t.Fatalf("expected active guard denial, got %s", output.String())
	}
}

func TestSecretsGuardActivatedRelativeConfigResolutionFailureFailsClosed(t *testing.T) {
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

	var output bytes.Buffer
	if err := runSecretsGuardCmd(strings.NewReader("{"), &output); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(output.String(), `"permissionDecision":"deny"`) {
		t.Fatalf("expected active resolution failure denial, got %s", output.String())
	}
}

func TestSecretsGuardOversizedInputHasActionableDenial(t *testing.T) {
	t.Parallel()
	payload := `{"tool_name":"Write","tool_input":{"file_path":"docs/large.md","content":"` + strings.Repeat("x", maxSecretHookPayloadBytes) + `"}}`
	var output bytes.Buffer
	if err := runActiveSecretsGuardCmd(strings.NewReader(payload), &output); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(output.String(), "oversized tool payload") {
		t.Fatalf("expected size-specific denial, got %s", output.String())
	}
}

func TestSecretsGuardProtectsActivationCache(t *testing.T) {
	t.Parallel()
	input := secretHookInput{ToolName: "Write", ToolInput: map[string]any{"filePath": ".moltnet/agent/activation-cache.json"}}
	payload, err := json.Marshal(input)
	if err != nil {
		t.Fatal(err)
	}
	var output bytes.Buffer
	if err := runActiveSecretsGuardCmd(bytes.NewReader(payload), &output); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(output.String(), `"permissionDecision":"deny"`) {
		t.Fatalf("expected activation cache denial, got %s", output.String())
	}
}

// --- Issue #1868: distinguish credential access from harmless config reads ---

func TestSecretsGuardAllowsReadsOfManagedConfigFiles(t *testing.T) {
	t.Parallel()
	commands := []string{
		`rg -n TODO .codex/hooks.json`,
		`sed -n 1,40p .claude/hooks/moltnet-secret-guard.sh`,
		`git diff -- .codex/hooks.json`,
		`git status --short .codex/hooks.json`,
		`git log -- .claude/settings.json`,
		`git grep TODO HEAD -- .codex/hooks.json`,
		`head -n 5 .claude/settings.json`,
		`cat .codex/hooks.json`,
		`ls .claude`,
		`cp .codex/hooks.json /tmp/hooks-backup.json`,
		`wc -l .claude/settings.json`,
		`stat .codex/hooks.json`,
		`test -f .codex/hooks.json`,
	}
	for _, command := range commands {
		if reason := evaluateSecretsShellWithContext(command, testSecretGuardPathContext(t)); reason != "" {
			t.Errorf("expected allow for managed config read %q, got denial: %s", command, reason)
		}
	}
}

func TestSecretsGuardDeniesMutationsOfManagedConfigFiles(t *testing.T) {
	t.Parallel()
	commands := []string{
		`cp /tmp/hooks.json .codex/hooks.json`,
		`mv /tmp/hooks.json .codex/hooks.json`,
		`mv .codex/hooks.json /tmp/old.json`,
		`chmod 600 .codex/hooks.json`,
		`rm .claude/hooks/moltnet-secret-guard.sh`,
		`echo x > .codex/hooks.json`,
		`tee .claude/settings.json`,
	}
	for _, command := range commands {
		if reason := evaluateSecretsShellWithContext(command, testSecretGuardPathContext(t)); reason == "" {
			t.Errorf("expected denial for managed config mutation %q", command)
		}
	}
}

func TestSecretsGuardAllowsNativeReadOfManagedConfigFiles(t *testing.T) {
	t.Parallel()
	pathContext := testSecretGuardPathContext(t)
	payloads := []map[string]any{
		{"tool_name": "Read", "tool_input": map[string]any{"file_path": filepath.Join(pathContext.currentRoot, ".codex", "hooks.json")}},
		{"tool_name": "Read", "tool_input": map[string]any{"file_path": filepath.Join(pathContext.currentRoot, ".claude", "settings.json")}},
		{"tool_name": "Grep", "tool_input": map[string]any{"path": filepath.Join(pathContext.currentRoot, ".claude", "hooks")}},
	}
	for _, payload := range payloads {
		encoded, _ := json.Marshal(payload)
		var output bytes.Buffer
		if err := runActiveSecretsGuardCmd(bytes.NewReader(encoded), &output); err != nil {
			t.Fatal(err)
		}
		if output.Len() != 0 {
			t.Errorf("expected allow for managed config read %v, got: %s", payload, output.String())
		}
	}
}

func TestSecretsGuardDeniesNativeWriteOfManagedConfigFiles(t *testing.T) {
	t.Parallel()
	pathContext := testSecretGuardPathContext(t)
	payloads := []map[string]any{
		{"tool_name": "Write", "tool_input": map[string]any{"filePath": filepath.Join(pathContext.currentRoot, ".codex", "hooks.json")}},
		{"tool_name": "Edit", "tool_input": map[string]any{"filePath": filepath.Join(pathContext.currentRoot, ".claude", "settings.json")}},
	}
	for _, payload := range payloads {
		encoded, _ := json.Marshal(payload)
		var output bytes.Buffer
		if err := runActiveSecretsGuardCmd(bytes.NewReader(encoded), &output); err != nil {
			t.Fatal(err)
		}
		if !strings.Contains(output.String(), `"permissionDecision":"deny"`) {
			t.Errorf("expected managed config write denial for %v, got %s", payload, output.String())
		}
	}
}

func TestSecretsGuardDoesNotMatchSuffixFalsePositives(t *testing.T) {
	t.Parallel()
	paths := []string{
		"/tmp/unrelated-project/.codex/hooks.json",
		"/tmp/unrelated-project/.claude/settings.json",
		"~/.codex/config.toml",
		"~/.claude/settings.json",
		"/etc/.opencode/plugins/moltnet-secret-guard.ts",
	}
	for _, path := range paths {
		if classifyProtectedPath(path) != pathNone {
			t.Errorf("expected pathNone for unrelated path %s, got %v", path, classifyProtectedPath(path))
		}
	}

	// Shell commands against unrelated dirs should be allowed.
	commands := []string{
		`ls ~/.codex`,
		`ls ~/.claude`,
		`ls ~/.opencode`,
		`ls /tmp/unrelated-project/.codex`,
		`head -n 5 /tmp/unrelated-project/.claude/settings.json`,
		`rg model ~/.codex/config.toml`,
	}
	for _, command := range commands {
		if reason := evaluateSecretsShellWithContext(command, testSecretGuardPathContext(t)); reason != "" {
			t.Errorf("expected allow for unrelated path %q, got denial: %s", command, reason)
		}
	}
}

func TestSecretsGuardClassifiesManagedConfigAcrossRepositoryPathSpellings(t *testing.T) {
	t.Parallel()
	tempRoot := t.TempDir()
	mainRoot := filepath.Join(tempRoot, "main")
	currentRoot := filepath.Join(tempRoot, "linked-worktree")
	cwd := filepath.Join(currentRoot, "apps", "cli")
	for _, dir := range []string{
		filepath.Join(mainRoot, ".codex"),
		filepath.Join(currentRoot, ".codex"),
		cwd,
	} {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			t.Fatal(err)
		}
	}
	alias := filepath.Join(tempRoot, "checkout-alias")
	if err := os.Symlink(currentRoot, alias); err != nil {
		t.Fatal(err)
	}

	pathContext := newSecretGuardPathContext(cwd, currentRoot, mainRoot)
	protected := []string{
		filepath.Join("..", "..", ".codex", "hooks.json"),
		filepath.Join(currentRoot, ".codex", "hooks.json"),
		filepath.Join(mainRoot, ".codex", "hooks.json"),
		filepath.Join(alias, ".codex", "hooks.json"),
	}
	for _, path := range protected {
		if got := classifyProtectedPathWithContext(path, pathContext); got != pathManagedConfig {
			t.Errorf("classify %q = %v, want pathManagedConfig", path, got)
		}
	}
	if reason := evaluateSecretsShellWithContext(`cat ../../.codex/hooks.json`, pathContext); reason != "" {
		t.Errorf("expected nested-CWD managed config read to be allowed, got: %s", reason)
	}
	if reason := evaluateSecretsShellWithContext(`echo x > ../../.codex/hooks.json`, pathContext); reason == "" {
		t.Error("expected nested-CWD managed config mutation to be denied")
	}

	unrelated := []string{
		filepath.Join(cwd, ".codex", "hooks.json"),
		filepath.Join(tempRoot, "unrelated", ".codex", "hooks.json"),
		"~/.codex/hooks.json",
	}
	for _, path := range unrelated {
		if got := classifyProtectedPathWithContext(path, pathContext); got != pathNone {
			t.Errorf("classify unrelated %q = %v, want pathNone", path, got)
		}
	}
}

func TestSecretsGuardTraversalUsesRepositoryContext(t *testing.T) {
	t.Parallel()
	tempRoot := t.TempDir()
	mainRoot := filepath.Join(tempRoot, "main")
	currentRoot := filepath.Join(tempRoot, "linked-worktree")
	cwd := filepath.Join(currentRoot, "apps", "cli")
	for _, dir := range []string{mainRoot, cwd} {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			t.Fatal(err)
		}
	}
	pathContext := newSecretGuardPathContext(cwd, currentRoot, mainRoot)

	denied := []string{
		`find ../.. -type f -print`,
		`rg --hidden canary ../..`,
		`find ` + mainRoot + ` -type f -print`,
		`tar -cf /tmp/repo.tar ` + currentRoot,
	}
	for _, command := range denied {
		if reason := evaluateSecretsShellWithContext(command, pathContext); reason == "" {
			t.Errorf("expected contextual traversal denial for %q", command)
		}
	}

	allowed := []string{
		`find . -type f -print`,
		`rg --hidden canary .`,
		`find ` + filepath.Join(tempRoot, "unrelated") + ` -type f -print`,
	}
	for _, command := range allowed {
		if reason := evaluateSecretsShellWithContext(command, pathContext); reason != "" {
			t.Errorf("expected contextual traversal allow for %q, got: %s", command, reason)
		}
	}
}

func TestSecretsGuardDeniesRecursiveTraversalOfRepoRoot(t *testing.T) {
	t.Parallel()
	commands := []string{
		`rg --hidden canary .`,
		`rg -H canary .`,
		`grep -R canary .`,
		`grep -r canary .`,
		`find . -type f -print`,
		`tar -cf /tmp/repo.tar .`,
		`zip -r /tmp/repo.zip .`,
		`cp -R . /tmp/backup`,
	}
	for _, command := range commands {
		if reason := evaluateSecretsShellWithContext(command, testSecretGuardPathContext(t)); reason == "" {
			t.Errorf("expected denial for recursive traversal %q", command)
		}
	}
}

func TestSecretsGuardAllowsNonRecursiveTraversalOfSubdirs(t *testing.T) {
	t.Parallel()
	commands := []string{
		`rg canary docs`,
		`grep canary docs`,
		`find docs -type f -print`,
		`tar -cf /tmp/docs.tar docs`,
		`rg --hidden canary docs`,
	}
	for _, command := range commands {
		if reason := evaluateSecretsShellWithContext(command, testSecretGuardPathContext(t)); reason != "" {
			t.Errorf("expected allow for non-recursive subdir %q, got denial: %s", command, reason)
		}
	}
}

func TestSecretsGuardKeepsCredentialConfidentialityStrict(t *testing.T) {
	t.Parallel()
	// Reads of actual credential material remain denied even with read tools.
	commands := []string{
		`cat .moltnet/agent/moltnet.json`,
		`sed -n 1p .moltnet/agent/env`,
		`rg secret .moltnet/agent/moltnet.json`,
		`head .moltnet/agent/moltnet.json`,
		`jq . .moltnet/agent/moltnet.json`,
		`cp .moltnet/agent/moltnet.json /tmp/leaked.json`,
		`cp .moltnet/agent/env /tmp/leaked-env`,
	}
	for _, command := range commands {
		if reason := evaluateSecretsShellWithContext(command, testSecretGuardPathContext(t)); reason == "" {
			t.Errorf("expected denial for credential read %q", command)
		}
	}
}

func TestCanonicalGuidanceDoesNotReadCredentialFiles(t *testing.T) {
	t.Parallel()
	repoRoot := filepath.Clean(filepath.Join("..", ".."))
	unsafe := regexp.MustCompile(`(?im)(?:^|\n)\s*(?:(?:cat|sed|grep|rg|head|tail|awk|jq|strings|xxd|base64)\s+[^\n]*\.moltnet/[^\n]*(?:/env|moltnet\.json|\.pem|id_ed25519)|source\s+\.moltnet/[^\s]+/env)`)
	paths := []string{
		filepath.Join(repoRoot, ".agents", "skills"),
		filepath.Join(repoRoot, "docs"),
		filepath.Join(repoRoot, "packages", "legreffier-cli", "README.md"),
	}
	for _, root := range paths {
		err := filepath.WalkDir(root, func(path string, entry fs.DirEntry, err error) error {
			if err != nil {
				return err
			}
			if entry.IsDir() || filepath.Ext(path) != ".md" || filepath.Base(path) == "CHANGELOG.md" {
				return nil
			}
			data, err := os.ReadFile(path)
			if err != nil {
				return err
			}
			if match := unsafe.Find(data); match != nil {
				t.Errorf("unsafe credential-reading guidance in %s: %q", path, match)
			}
			return nil
		})
		if err != nil {
			t.Fatalf("scan %s: %v", root, err)
		}
	}
}

func TestCanonicalGuidanceUsesAtomicEnvConfiguration(t *testing.T) {
	t.Parallel()
	repoRoot := filepath.Clean(filepath.Join("..", ".."))
	checks := []struct {
		path       string
		forbidden  string
		requireCLI bool
	}{
		{
			path:       filepath.Join(repoRoot, ".agents", "skills", "legreffier-onboarding", "references", "stage-2-diary-connection.md"),
			forbidden:  "Write both `MOLTNET_TEAM_ID` and `MOLTNET_DIARY_ID`",
			requireCLI: true,
		},
		{
			path:       filepath.Join(repoRoot, "docs", "reference", "agent-configuration.md"),
			forbidden:  "Set these variables in `.moltnet/<agent>/env`",
			requireCLI: true,
		},
	}
	for _, check := range checks {
		data, err := os.ReadFile(check.path)
		if err != nil {
			t.Fatal(err)
		}
		content := string(data)
		if strings.Contains(content, check.forbidden) {
			t.Errorf("unsafe direct-edit guidance remains in %s", check.path)
		}
		if check.requireCLI && !strings.Contains(content, "moltnet env configure") {
			t.Errorf("atomic env configuration guidance missing from %s", check.path)
		}
	}
}

func TestSecretsGuardDeniesReadsUnderSecretRoot(t *testing.T) {
	root := t.TempDir()
	t.Setenv(secretRootEnv, root)
	pathContext := testSecretGuardPathContext(t)
	for _, command := range []string{
		"cat " + filepath.Join(root, "agent-key", "identity-1"),
		"head " + root + "/github-app/1/private-key",
		"ls " + root,
	} {
		if reason := evaluateSecretsShellWithContext(command, pathContext); reason == "" {
			t.Fatalf("expected denial for %q", command)
		}
	}
	if reason := evaluateSecretsShellWithContext("cat "+filepath.Join(t.TempDir(), "unrelated"), pathContext); reason != "" {
		t.Fatalf("unexpected denial outside the secret root: %s", reason)
	}
}

func TestClassifySecretRootPath(t *testing.T) {
	t.Parallel()
	lookup := func(name string) (string, bool) {
		if name == secretRootEnv {
			return "/run/secrets", true
		}
		return "", false
	}
	cases := map[string]pathClass{
		"/run/secrets":              pathCredential,
		"/run/secrets/agent-key/id": pathCredential,
		"/run/secrets-other/x":      pathNone,
		"/etc/passwd":               pathNone,
		"relative/inside":           pathNone,
	}
	for value, want := range cases {
		if got := classifySecretRootPath(value, "/work", lookup); got != want {
			t.Errorf("classifySecretRootPath(%q) = %v, want %v", value, got, want)
		}
	}
	if got := classifySecretRootPath("secrets/k", "/run", lookup); got != pathCredential {
		t.Errorf("relative path under cwd inside root = %v, want pathCredential", got)
	}
	if got := classifySecretRootPath("/run/secrets/x", "/work", func(string) (string, bool) { return "", false }); got != pathNone {
		t.Errorf("unset root = %v, want pathNone", got)
	}
	if got := classifySecretRootPath("/run/secrets/x", "", lookup); got != pathCredential {
		t.Errorf("absolute path with empty cwd = %v, want pathCredential", got)
	}
}
