package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestAgentsInitCommandIsAgentScoped(t *testing.T) {
	root := NewRootCmd("test", "")
	stdout, _, err := executeCommand(root, "agents", "init", "--help")
	if err != nil {
		t.Fatalf("agents init --help: %v", err)
	}
	for _, expected := range []string{"--name", "--org", "--dir", "--no-open"} {
		if !strings.Contains(stdout, expected) {
			t.Errorf("help missing %s:\n%s", expected, stdout)
		}
	}
	if strings.Contains(stdout, "claude") || strings.Contains(stdout, "codex") {
		t.Fatalf("agents init must not configure agent hosts:\n%s", stdout)
	}
}

func TestWriteAgentEnvContainsOnlyNonSecretActivationValues(t *testing.T) {
	dir := t.TempDir()
	if err := writeAgentEnv(dir, "test-agent", "client-id", "app-id", "install-id", "A-B-C-D"); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(filepath.Join(dir, "env"))
	if err != nil {
		t.Fatal(err)
	}
	content := string(data)
	for _, expected := range []string{
		"TEST_AGENT_CLIENT_ID='client-id'",
		"GIT_CONFIG_GLOBAL='.moltnet/test-agent/gitconfig'",
		"MOLTNET_AGENT_NAME='test-agent'",
		"MOLTNET_FINGERPRINT='A-B-C-D'",
	} {
		if !strings.Contains(content, expected) {
			t.Errorf("env missing %q:\n%s", expected, content)
		}
	}
	if strings.Contains(strings.ToLower(content), "secret") || strings.Contains(content, "PRIVATE_KEY") {
		t.Fatalf("env contains a secret-bearing field:\n%s", content)
	}
}

func TestAgentsInitStateRoundTrip(t *testing.T) {
	path := filepath.Join(t.TempDir(), agentsInitStateFile)
	want := &agentsInitState{WorkflowID: "workflow", ManifestURL: "https://example.test", AppID: "1", AppSlug: "agent"}
	if err := writeAgentsInitState(path, want); err != nil {
		t.Fatal(err)
	}
	got, err := readAgentsInitState(path)
	if err != nil {
		t.Fatal(err)
	}
	if *got != *want {
		t.Fatalf("state = %#v, want %#v", got, want)
	}
}

func TestAgentInitComplete(t *testing.T) {
	complete := &CredentialsFile{
		IdentityID: "identity",
		OAuth2:     CredentialsOAuth2{ClientID: "client"},
		GitHub:     &GitHubSection{AppID: "app", InstallationID: "installation"},
	}
	if !agentInitComplete(complete) {
		t.Fatal("complete credentials were not recognized")
	}
	complete.GitHub.InstallationID = ""
	if agentInitComplete(complete) {
		t.Fatal("incomplete credentials were accepted")
	}
}
