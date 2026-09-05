package main

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func mustGit(t *testing.T, dir string, args ...string) {
	t.Helper()
	cmd := exec.Command("git", args...)
	cmd.Dir = dir
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("git %s: %v\n%s", strings.Join(args, " "), err, out)
	}
}

func TestToEnvPrefix(t *testing.T) {
	t.Parallel()
	tests := []struct{ input, want string }{
		{"legreffier", "LEGREFFIER"},
		{"my-agent", "MY_AGENT"},
		{"agent.v2", "AGENT_V2"},
		{"ALREADY_UPPER", "ALREADY_UPPER"},
	}
	for _, tt := range tests {
		if got := toEnvPrefix(tt.input); got != tt.want {
			t.Errorf("toEnvPrefix(%q) = %q, want %q", tt.input, got, tt.want)
		}
	}
}

func TestParseEnvFile(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	envPath := filepath.Join(dir, "env")

	content := `# comment
SIMPLE=value
SINGLE_QUOTED='hello world'
DOUBLE_QUOTED="hello world"
EMPTY=
WITH_EQUALS='a=b=c'
GIT_CONFIG_GLOBAL='.moltnet/test/gitconfig'
`
	if err := os.WriteFile(envPath, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
	vars, err := parseEnvFile(envPath)
	if err != nil {
		t.Fatalf("parseEnvFile: %v", err)
	}
	tests := map[string]string{
		"SIMPLE":            "value",
		"SINGLE_QUOTED":     "hello world",
		"DOUBLE_QUOTED":     "hello world",
		"EMPTY":             "",
		"WITH_EQUALS":       "a=b=c",
		"GIT_CONFIG_GLOBAL": ".moltnet/test/gitconfig",
	}
	for k, want := range tests {
		if got, ok := vars[k]; !ok {
			t.Errorf("missing key %q", k)
		} else if got != want {
			t.Errorf("key %q = %q, want %q", k, got, want)
		}
	}
	if _, ok := vars["# comment"]; ok {
		t.Error("comment parsed as key")
	}
}

func TestParseEnvFileMissing(t *testing.T) {
	t.Parallel()
	_, err := parseEnvFile("/nonexistent/env")
	if err == nil {
		t.Fatal("expected error for missing file")
	}
}

func TestResolveMoltnetDir_CWD(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	moltnetDir := filepath.Join(dir, ".moltnet")
	if err := os.Mkdir(moltnetDir, 0o755); err != nil {
		t.Fatal(err)
	}
	// resolveMoltnetDir canonicalizes its return (resolves symlinks) so the
	// activation cache key is stable across CWD spellings (e.g. /var vs
	// /private/var on macOS). Compare to the canonical form.
	want, err := filepath.EvalSymlinks(moltnetDir)
	if err != nil {
		t.Fatalf("eval symlinks: %v", err)
	}
	got, err := resolveMoltnetDir(dir)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got != want {
		t.Errorf("got %q, want %q", got, want)
	}
}

func TestResolveMoltnetDir_Missing(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	_, err := resolveMoltnetDir(dir)
	if err == nil {
		t.Fatal("expected error for missing .moltnet")
	}
	assertMissingMoltnetCredentialsError(t, err, dir, "not in a git repo")
}

func TestResolveMoltnetDir_MissingInLinkedWorktree(t *testing.T) {
	t.Parallel()
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git not available")
	}

	mainRoot := filepath.Join(t.TempDir(), "main")
	if err := os.Mkdir(mainRoot, 0o755); err != nil {
		t.Fatal(err)
	}
	mustGit(t, mainRoot, "init", "-q", "-b", "main")
	mustGit(t, mainRoot, "-c", "user.email=t@e", "-c", "user.name=t", "commit", "--allow-empty", "-q", "-m", "init")

	worktreeRoot := filepath.Join(t.TempDir(), "wt")
	mustGit(t, mainRoot, "worktree", "add", "-q", worktreeRoot, "-b", "feature")
	t.Cleanup(func() { _ = exec.Command("git", "-C", mainRoot, "worktree", "remove", "-f", worktreeRoot).Run() })

	_, err := resolveMoltnetDir(worktreeRoot)
	if err == nil {
		t.Fatal("expected error for missing .moltnet")
	}
	assertMissingMoltnetCredentialsError(t, err, worktreeRoot, mainRoot)
}

func TestResolveMoltnetDirAndRoot_LinkedWorktreeWithSharedSymlink(t *testing.T) {
	t.Parallel()
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git not available")
	}

	mainRoot := filepath.Join(t.TempDir(), "main")
	if err := os.Mkdir(mainRoot, 0o755); err != nil {
		t.Fatal(err)
	}
	mustGit(t, mainRoot, "init", "-q", "-b", "main")
	mustGit(t, mainRoot, "-c", "user.email=t@e", "-c", "user.name=t", "commit", "--allow-empty", "-q", "-m", "init")
	mainMoltnet := filepath.Join(mainRoot, ".moltnet")
	if err := os.Mkdir(mainMoltnet, 0o755); err != nil {
		t.Fatal(err)
	}

	worktreeRoot := filepath.Join(t.TempDir(), "wt")
	mustGit(t, mainRoot, "worktree", "add", "-q", worktreeRoot, "-b", "feature-symlink")
	t.Cleanup(func() { _ = exec.Command("git", "-C", mainRoot, "worktree", "remove", "-f", worktreeRoot).Run() })
	if err := os.Symlink(mainMoltnet, filepath.Join(worktreeRoot, ".moltnet")); err != nil {
		t.Fatal(err)
	}

	gotDir, gotRoot, err := resolveMoltnetDirAndRoot(worktreeRoot)
	if err != nil {
		t.Fatalf("resolve: %v", err)
	}
	if gotDir != canonicalizeRoot(mainMoltnet) {
		t.Fatalf("moltnet dir = %q, want %q", gotDir, canonicalizeRoot(mainMoltnet))
	}
	if gotRoot != canonicalizeRoot(mainRoot) {
		t.Fatalf("repo root = %q, want %q", gotRoot, canonicalizeRoot(mainRoot))
	}
}

func assertMissingMoltnetCredentialsError(t *testing.T, err error, want ...string) {
	t.Helper()
	message := err.Error()
	required := append([]string{
		"MoltNet agent credentials",
		".moltnet",
		"moltnet agents init --name <agent>",
		"moltnet config init-from-env --agent <agent>",
	}, want...)
	for _, text := range required {
		if !strings.Contains(message, text) {
			t.Fatalf("expected error to contain %q, got:\n%s", text, message)
		}
	}
}

func TestResolveAgentName_Flag(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	moltnetDir := filepath.Join(dir, ".moltnet")
	agentDir := filepath.Join(moltnetDir, "test-agent")
	os.MkdirAll(agentDir, 0o755)
	os.WriteFile(filepath.Join(agentDir, "moltnet.json"), []byte("{}"), 0o644)

	got, err := resolveAgentName(moltnetDir, "test-agent")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got != "test-agent" {
		t.Errorf("got %q, want %q", got, "test-agent")
	}
}

func TestResolveAgentName_DefaultFile(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	moltnetDir := filepath.Join(dir, ".moltnet")
	agentDir := filepath.Join(moltnetDir, "my-bot")
	os.MkdirAll(agentDir, 0o755)
	os.WriteFile(filepath.Join(agentDir, "moltnet.json"), []byte("{}"), 0o644)
	os.WriteFile(filepath.Join(moltnetDir, "default-agent"), []byte("my-bot"), 0o644)

	got, err := resolveAgentName(moltnetDir, "")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got != "my-bot" {
		t.Errorf("got %q, want %q", got, "my-bot")
	}
}

func TestResolveAgentName_SingleAgent(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	moltnetDir := filepath.Join(dir, ".moltnet")
	agentDir := filepath.Join(moltnetDir, "solo-agent")
	os.MkdirAll(agentDir, 0o755)
	os.WriteFile(filepath.Join(agentDir, "moltnet.json"), []byte("{}"), 0o644)

	got, err := resolveAgentName(moltnetDir, "")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got != "solo-agent" {
		t.Errorf("got %q, want %q", got, "solo-agent")
	}
}

func TestResolveAgentName_MultipleNoDefault(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	moltnetDir := filepath.Join(dir, ".moltnet")
	for _, name := range []string{"agent-a", "agent-b"} {
		d := filepath.Join(moltnetDir, name)
		os.MkdirAll(d, 0o755)
		os.WriteFile(filepath.Join(d, "moltnet.json"), []byte("{}"), 0o644)
	}

	_, err := resolveAgentName(moltnetDir, "")
	if err == nil {
		t.Fatal("expected error with multiple agents and no default")
	}
	if !strings.Contains(err.Error(), "agent-a") || !strings.Contains(err.Error(), "agent-b") {
		t.Errorf("error should list available agents, got: %v", err)
	}
}

func TestResolveAgentName_FlagNotFound(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	moltnetDir := filepath.Join(dir, ".moltnet")
	os.MkdirAll(moltnetDir, 0o755)

	_, err := resolveAgentName(moltnetDir, "nonexistent")
	if err == nil {
		t.Fatal("expected error for nonexistent agent")
	}
}

// --- use command tests ---

func TestUseCommand(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("HOME", dir)
	agentDir := filepath.Join(dir, ".config", "moltnet", "identities", "test-agent")
	os.MkdirAll(agentDir, 0o755)
	os.WriteFile(filepath.Join(agentDir, "moltnet.json"), []byte("{}"), 0o644)
	os.WriteFile(filepath.Join(agentDir, "env"), []byte("X=1\n"), 0o644)

	root := NewRootCmd("test", "")
	stdout, _, err := executeCommand(root, "use", "test-agent")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !strings.Contains(stdout, "test-agent") {
		t.Errorf("expected agent name in output, got: %s", stdout)
	}

	selector, err := readIdentitySelector()
	if err != nil || selector.DefaultIdentity != "test-agent" {
		t.Fatalf("identity selector = %#v, %v", selector, err)
	}
}

func TestUseCommandMissingAgent(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	os.MkdirAll(filepath.Join(dir, ".moltnet"), 0o755)

	root := NewRootCmd("test", "")
	_, _, err := executeCommand(root, "use", "nonexistent", "--dir", dir)
	if err == nil {
		t.Fatal("expected error for nonexistent agent")
	}
}

// --- env check command tests ---

func TestEnvCheckPass(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("HOME", dir)
	agentDir := filepath.Join(dir, ".config", "moltnet", "identities", "test-agent")
	os.MkdirAll(agentDir, 0o755)
	_, _ = WriteConfigTo(&CredentialsFile{
		IdentityID: "test-identity",
		OAuth2:     CredentialsOAuth2{ClientID: "cid", ClientSecret: "csec"},
	}, filepath.Join(agentDir, "moltnet.json"))

	gitconfigPath := filepath.Join(agentDir, "gitconfig")
	os.WriteFile(gitconfigPath, []byte("[user]\n"), 0o644)
	pemPath := filepath.Join(agentDir, "test-agent.pem")
	os.WriteFile(pemPath, []byte("---PEM---"), 0o600)

	envContent := fmt.Sprintf("TEST_AGENT_CLIENT_ID='cid'\nTEST_AGENT_GITHUB_APP_ID='test-agent'\nTEST_AGENT_GITHUB_APP_PRIVATE_KEY_PATH='%s'\nTEST_AGENT_GITHUB_APP_INSTALLATION_ID='12345'\nGIT_CONFIG_GLOBAL='%s'\n", pemPath, gitconfigPath)
	os.WriteFile(filepath.Join(agentDir, "env"), []byte(envContent), 0o644)

	root := NewRootCmd("test", "")
	stdout, _, err := executeCommand(root, "env", "check", "--identity", "test-agent")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !strings.Contains(stdout, "All required checks passed") {
		t.Errorf("expected success message, got: %s", stdout)
	}
}

func TestEnvCheckAcceptsDeprecatedAgentAlias(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("HOME", dir)
	agentDir := filepath.Join(dir, ".config", "moltnet", "identities", "test-agent")
	if err := os.MkdirAll(agentDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if _, err := WriteConfigTo(&CredentialsFile{IdentityID: "test-identity", OAuth2: CredentialsOAuth2{ClientID: "cid", ClientSecret: "csec"}}, filepath.Join(agentDir, "moltnet.json")); err != nil {
		t.Fatal(err)
	}
	gitconfigPath := filepath.Join(agentDir, "gitconfig")
	if err := os.WriteFile(gitconfigPath, []byte("[user]\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	pemPath := filepath.Join(agentDir, "test-agent.pem")
	if err := os.WriteFile(pemPath, []byte("---PEM---"), 0o600); err != nil {
		t.Fatal(err)
	}
	env := fmt.Sprintf("TEST_AGENT_CLIENT_ID='cid'\nTEST_AGENT_GITHUB_APP_ID='test-agent'\nTEST_AGENT_GITHUB_APP_PRIVATE_KEY_PATH='%s'\nTEST_AGENT_GITHUB_APP_INSTALLATION_ID='12345'\nGIT_CONFIG_GLOBAL='%s'\n", pemPath, gitconfigPath)
	if err := os.WriteFile(filepath.Join(agentDir, "env"), []byte(env), 0o644); err != nil {
		t.Fatal(err)
	}

	root := NewRootCmd("test", "")
	stdout, _, err := executeCommand(root, "env", "check", "--agent", "test-agent", "--dir", ".")
	if err != nil {
		t.Fatalf("env check legacy aliases: %v", err)
	}
	if !strings.Contains(stdout, "All required checks passed") {
		t.Fatalf("unexpected output: %s", stdout)
	}
}

func TestEnvCheckMissingVars(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("HOME", dir)
	agentDir := filepath.Join(dir, ".config", "moltnet", "identities", "test-agent")
	os.MkdirAll(agentDir, 0o755)
	os.WriteFile(filepath.Join(agentDir, "moltnet.json"), []byte("{}"), 0o644)
	os.WriteFile(filepath.Join(agentDir, "env"), []byte("TEST_AGENT_CLIENT_ID='cid'\n"), 0o644)

	root := NewRootCmd("test", "")
	_, _, err := executeCommand(root, "env", "check", "--identity", "test-agent")
	if err == nil {
		t.Fatal("expected error for missing required vars")
	}
}

// --- start command tests ---

func TestStartDryRun(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("HOME", dir)
	agentDir := filepath.Join(dir, ".config", "moltnet", "identities", "test-agent")
	os.MkdirAll(agentDir, 0o755)
	_, _ = WriteConfigTo(&CredentialsFile{
		IdentityID: "test-identity",
		OAuth2:     CredentialsOAuth2{ClientID: "cid", ClientSecret: "super-secret"},
	}, filepath.Join(agentDir, "moltnet.json"))
	gitconfig := filepath.Join(agentDir, "gitconfig")
	os.WriteFile(filepath.Join(agentDir, "env"), []byte("MY_VAR='hello'\nGIT_CONFIG_GLOBAL='"+gitconfig+"'\n"), 0o644)

	root := NewRootCmd("test", "")
	stdout, _, err := executeCommand(root, "start", "echo", "--identity", "test-agent", "--dry-run")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !strings.Contains(stdout, "MY_VAR=hello") {
		t.Errorf("expected MY_VAR in dry-run output, got: %s", stdout)
	}
	if !strings.Contains(stdout, "GIT_CONFIG_GLOBAL="+gitconfig) {
		t.Errorf("expected absolute GIT_CONFIG_GLOBAL path, got: %s", stdout)
	}
	if !strings.Contains(stdout, "echo") {
		t.Errorf("expected target command in dry-run output, got: %s", stdout)
	}
	// Secrets should be redacted
	if strings.Contains(stdout, "super-secret") {
		t.Error("dry-run should not print secret values")
	}
	if !strings.Contains(stdout, "TEST_AGENT_CLIENT_SECRET=***") {
		t.Errorf("expected redacted secret in dry-run output, got: %s", stdout)
	}
}

func TestStartDryRunForwardsTargetArgs(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("HOME", dir)
	agentDir := filepath.Join(dir, ".config", "moltnet", "identities", "test-agent")
	os.MkdirAll(agentDir, 0o755)
	_, _ = WriteConfigTo(&CredentialsFile{
		IdentityID: "test-identity",
		OAuth2:     CredentialsOAuth2{ClientID: "cid", ClientSecret: "target-secret"},
	}, filepath.Join(agentDir, "moltnet.json"))
	os.WriteFile(filepath.Join(agentDir, "env"), []byte("MY_VAR='hello'\n"), 0o644)

	root := NewRootCmd("test", "")
	stdout, _, err := executeCommand(
		root,
		"start",
		"echo",
		"--identity",
		"test-agent",
		"--dry-run",
		"--",
		"--model",
		"gpt-5.4",
		"--profile",
		"dev",
	)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !strings.Contains(stdout, "Forwarded target arguments:") {
		t.Fatalf("expected forwarded argument section, got: %s", stdout)
	}
	for _, want := range []string{`"--model"`, `"gpt-5.4"`, `"--profile"`, `"dev"`} {
		if !strings.Contains(stdout, want) {
			t.Errorf("expected dry-run output to include %s, got: %s", want, stdout)
		}
	}
}

func TestStartInjectsKeyringSecretOnlyIntoChildEnvironment(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("HOME", dir)
	agentDir := filepath.Join(dir, ".config", "moltnet", "identities", "test-agent")
	if err := os.MkdirAll(agentDir, 0o755); err != nil {
		t.Fatal(err)
	}
	key := OAuth2SecretKey("identity-123", "client-456")
	if _, err := WriteConfigTo(&CredentialsFile{
		IdentityID: "identity-123",
		OAuth2: CredentialsOAuth2{
			ClientID: "client-456",
			ClientSecretRef: &SecretReference{
				Provider: osKeyringProviderName,
				Key:      key,
			},
		},
	}, filepath.Join(agentDir, "moltnet.json")); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(agentDir, "env"), []byte("MY_VAR='hello'\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("TEST_AGENT_CLIENT_SECRET", "stale-parent-secret")

	registry := NewSecretProviderRegistry()
	registry.Register(osKeyringProviderName, &memorySecretProvider{values: map[string]string{
		key: "launch-only-secret",
	}})
	var capturedPath string
	var capturedArgv, capturedEnv []string
	execFn := func(targetPath string, argv, env []string) error {
		capturedPath = targetPath
		capturedArgv = append([]string(nil), argv...)
		capturedEnv = append([]string(nil), env...)
		return nil
	}

	err := runStartCmdWithRegistryAndExec(
		NewRootCmd("test", ""),
		"test-agent",
		"echo",
		[]string{"hello"},
		false,
		registry,
		execFn,
	)
	if err != nil {
		t.Fatalf("runStartCmdWithRegistryAndExec: %v", err)
	}
	if capturedPath == "" {
		t.Fatal("child process was not invoked")
	}
	if got := strings.Join(capturedArgv, " "); got != "echo hello" {
		t.Fatalf("child argv = %q, want %q", got, "echo hello")
	}
	childEnv := make(map[string]string, len(capturedEnv))
	for _, entry := range capturedEnv {
		if index := strings.IndexByte(entry, '='); index > 0 {
			childEnv[entry[:index]] = entry[index+1:]
		}
	}
	if got := childEnv["TEST_AGENT_CLIENT_ID"]; got != "client-456" {
		t.Fatalf("child client id = %q, want %q", got, "client-456")
	}
	if got := childEnv["TEST_AGENT_CLIENT_SECRET"]; got != "launch-only-secret" {
		t.Fatalf("child client secret = %q, want launch-time keyring value", got)
	}
	if got := childEnv["MOLTNET_CLIENT_ID"]; got != "client-456" {
		t.Fatalf("generic child client id = %q, want %q", got, "client-456")
	}
	if got := childEnv["MOLTNET_CLIENT_SECRET"]; got != "launch-only-secret" {
		t.Fatalf("generic child client secret = %q, want launch-time keyring value", got)
	}
	wantCredentialsPath, err := filepath.Abs(filepath.Join(agentDir, "moltnet.json"))
	if err != nil {
		t.Fatal(err)
	}
	if got := childEnv["MOLTNET_CREDENTIALS_PATH"]; got != wantCredentialsPath {
		t.Fatalf("child credentials path = %q", got)
	}
	if !filepath.IsAbs(childEnv["MOLTNET_CREDENTIALS_PATH"]) {
		t.Fatalf("child credentials path is not absolute: %q", childEnv["MOLTNET_CREDENTIALS_PATH"])
	}
	for _, path := range []string{
		filepath.Join(agentDir, "moltnet.json"),
		filepath.Join(agentDir, "env"),
	} {
		content, readErr := os.ReadFile(path)
		if readErr != nil {
			t.Fatal(readErr)
		}
		if strings.Contains(string(content), "launch-only-secret") {
			t.Fatalf("launch secret persisted to %s", path)
		}
	}
}

func TestStartMissingAgent(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	os.MkdirAll(filepath.Join(dir, ".moltnet"), 0o755)

	root := NewRootCmd("test", "")
	_, _, err := executeCommand(root, "start", "claude", "--dir", dir)
	if err == nil {
		t.Fatal("expected error for missing agent")
	}
}

func TestStartMissingEnvFile(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("HOME", dir)
	agentDir := filepath.Join(dir, ".config", "moltnet", "identities", "test-agent")
	os.MkdirAll(agentDir, 0o755)
	os.WriteFile(filepath.Join(agentDir, "moltnet.json"), []byte("{}"), 0o644)

	root := NewRootCmd("test", "")
	_, _, err := executeCommand(root, "start", "claude", "--identity", "test-agent")
	if err == nil {
		t.Fatal("expected error for missing env file")
	}
	if !strings.Contains(err.Error(), "env") {
		t.Errorf("expected error about env file, got: %v", err)
	}
}
