package main

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

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
	got, err := resolveMoltnetDir(dir)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got != moltnetDir {
		t.Errorf("got %q, want %q", got, moltnetDir)
	}
}

func TestResolveMoltnetDir_Missing(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	_, err := resolveMoltnetDir(dir)
	if err == nil {
		t.Fatal("expected error for missing .moltnet")
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
	t.Parallel()
	dir := t.TempDir()
	moltnetDir := filepath.Join(dir, ".moltnet")
	agentDir := filepath.Join(moltnetDir, "test-agent")
	os.MkdirAll(agentDir, 0o755)
	os.WriteFile(filepath.Join(agentDir, "moltnet.json"), []byte("{}"), 0o644)
	os.WriteFile(filepath.Join(agentDir, "env"), []byte("X=1\n"), 0o644)

	root := NewRootCmd("test", "")
	stdout, _, err := executeCommand(root, "use", "test-agent", "--dir", dir)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !strings.Contains(stdout, "test-agent") {
		t.Errorf("expected agent name in output, got: %s", stdout)
	}

	data, err := os.ReadFile(filepath.Join(moltnetDir, "default-agent"))
	if err != nil {
		t.Fatal(err)
	}
	if strings.TrimSpace(string(data)) != "test-agent" {
		t.Errorf("default-agent = %q, want %q", string(data), "test-agent")
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
	t.Parallel()
	dir := t.TempDir()
	moltnetDir := filepath.Join(dir, ".moltnet")
	agentDir := filepath.Join(moltnetDir, "test-agent")
	os.MkdirAll(agentDir, 0o755)
	os.WriteFile(filepath.Join(agentDir, "moltnet.json"), []byte("{}"), 0o644)

	gitconfigPath := filepath.Join(agentDir, "gitconfig")
	os.WriteFile(gitconfigPath, []byte("[user]\n"), 0o644)
	pemPath := filepath.Join(agentDir, "test-agent.pem")
	os.WriteFile(pemPath, []byte("---PEM---"), 0o600)

	envContent := fmt.Sprintf("TEST_AGENT_CLIENT_ID='cid'\nTEST_AGENT_CLIENT_SECRET='csec'\nTEST_AGENT_GITHUB_APP_ID='test-agent'\nTEST_AGENT_GITHUB_APP_PRIVATE_KEY_PATH='%s'\nTEST_AGENT_GITHUB_APP_INSTALLATION_ID='12345'\nGIT_CONFIG_GLOBAL='%s'\n", pemPath, gitconfigPath)
	os.WriteFile(filepath.Join(agentDir, "env"), []byte(envContent), 0o644)

	root := NewRootCmd("test", "")
	stdout, _, err := executeCommand(root, "env", "check", "--agent", "test-agent", "--dir", dir)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !strings.Contains(stdout, "All required checks passed") {
		t.Errorf("expected success message, got: %s", stdout)
	}
}

func TestEnvCheckMissingVars(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	moltnetDir := filepath.Join(dir, ".moltnet")
	agentDir := filepath.Join(moltnetDir, "test-agent")
	os.MkdirAll(agentDir, 0o755)
	os.WriteFile(filepath.Join(agentDir, "moltnet.json"), []byte("{}"), 0o644)
	os.WriteFile(filepath.Join(agentDir, "env"), []byte("TEST_AGENT_CLIENT_ID='cid'\n"), 0o644)

	root := NewRootCmd("test", "")
	_, _, err := executeCommand(root, "env", "check", "--agent", "test-agent", "--dir", dir)
	if err == nil {
		t.Fatal("expected error for missing required vars")
	}
}

// --- start command tests ---

func TestStartDryRun(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	moltnetDir := filepath.Join(dir, ".moltnet")
	agentDir := filepath.Join(moltnetDir, "test-agent")
	os.MkdirAll(agentDir, 0o755)
	os.WriteFile(filepath.Join(agentDir, "moltnet.json"), []byte("{}"), 0o644)
	os.WriteFile(filepath.Join(agentDir, "env"), []byte("MY_VAR='hello'\nGIT_CONFIG_GLOBAL='.moltnet/test-agent/gitconfig'\nTEST_AGENT_CLIENT_SECRET='super-secret'\n"), 0o644)

	root := NewRootCmd("test", "")
	stdout, _, err := executeCommand(root, "start", "echo", "--agent", "test-agent", "--dir", dir, "--dry-run")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !strings.Contains(stdout, "MY_VAR=hello") {
		t.Errorf("expected MY_VAR in dry-run output, got: %s", stdout)
	}
	// GIT_CONFIG_GLOBAL should be resolved to an absolute path
	absGitconfig := filepath.Join(dir, ".moltnet", "test-agent", "gitconfig")
	if !strings.Contains(stdout, "GIT_CONFIG_GLOBAL="+absGitconfig) {
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
	t.Parallel()
	dir := t.TempDir()
	agentDir := filepath.Join(dir, ".moltnet", "test-agent")
	os.MkdirAll(agentDir, 0o755)
	os.WriteFile(filepath.Join(agentDir, "moltnet.json"), []byte("{}"), 0o644)

	root := NewRootCmd("test", "")
	_, _, err := executeCommand(root, "start", "claude", "--agent", "test-agent", "--dir", dir)
	if err == nil {
		t.Fatal("expected error for missing env file")
	}
	if !strings.Contains(err.Error(), "env") {
		t.Errorf("expected error about env file, got: %v", err)
	}
}
