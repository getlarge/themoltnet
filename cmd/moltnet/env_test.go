package main

import (
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
