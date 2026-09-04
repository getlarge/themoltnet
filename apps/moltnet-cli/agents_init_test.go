package main

import (
	"context"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

type agentsInitRoundTripFunc func(*http.Request) (*http.Response, error)

func (fn agentsInitRoundTripFunc) RoundTrip(req *http.Request) (*http.Response, error) {
	return fn(req)
}

func TestAgentsInitCommandIsAgentScoped(t *testing.T) {
	root := NewRootCmd("test", "")
	stdout, _, err := executeCommand(root, "agents", "init", "--help")
	if err != nil {
		t.Fatalf("agents init --help: %v", err)
	}
	for _, expected := range []string{"--name", "--org", "--no-open"} {
		if !strings.Contains(stdout, expected) {
			t.Errorf("help missing %s:\n%s", expected, stdout)
		}
	}
	if strings.Contains(stdout, "--dir") {
		t.Fatalf("agents init must not accept repository-target flags:\n%s", stdout)
	}
	if strings.Contains(stdout, "claude") || strings.Contains(stdout, "codex") {
		t.Fatalf("agents init must not configure agent hosts:\n%s", stdout)
	}
}

func TestValidateAgentNameRejectsTraversalAndShellSyntax(t *testing.T) {
	for _, valid := range []string{"legreffier", "agent-1", "Agent_2.test"} {
		if err := validateAgentName(valid); err != nil {
			t.Errorf("validateAgentName(%q): %v", valid, err)
		}
	}
	for _, invalid := range []string{"", "../escape", ".hidden", "a/b", "bad'name", "bad\nname", strings.Repeat("a", 64)} {
		if err := validateAgentName(invalid); err == nil {
			t.Errorf("validateAgentName(%q) unexpectedly succeeded", invalid)
		}
	}
}

func TestPrepareAgentDirectoryRejectsSymlink(t *testing.T) {
	repo := t.TempDir()
	moltnetDir := filepath.Join(repo, ".moltnet")
	if err := os.Mkdir(moltnetDir, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(t.TempDir(), filepath.Join(moltnetDir, "agent")); err != nil {
		t.Fatal(err)
	}
	if _, err := prepareAgentDirectory(repo, "agent"); err == nil || !strings.Contains(err.Error(), "symbolic link") {
		t.Fatalf("prepareAgentDirectory error = %v, want symbolic-link rejection", err)
	}
}

func TestPrepareAgentDirectoryRejectsManagedFileSymlink(t *testing.T) {
	repo := t.TempDir()
	agentDir := filepath.Join(repo, ".moltnet", "agent")
	if err := os.MkdirAll(agentDir, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(filepath.Join(t.TempDir(), "credentials.json"), filepath.Join(agentDir, "moltnet.json")); err != nil {
		t.Fatal(err)
	}
	if _, err := prepareAgentDirectory(repo, "agent"); err == nil || !strings.Contains(err.Error(), "symbolic link") {
		t.Fatalf("prepareAgentDirectory error = %v, want managed-file symlink rejection", err)
	}
}

func TestAgentsInitStateRoundTrip(t *testing.T) {
	path := filepath.Join(t.TempDir(), agentsInitStateFile)
	want := &agentsInitState{WorkflowID: "workflow", ManifestURL: "https://example.test", Phase: agentsInitPhaseStarted}
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

func TestAgentsInitRemoteCheckpointRequiresEveryRecoverableField(t *testing.T) {
	path := filepath.Join(t.TempDir(), agentsInitStateFile)
	state := &agentsInitState{
		WorkflowID:             "workflow",
		ManifestURL:            "https://example.test",
		Phase:                  agentsInitPhaseRemoteComplete,
		AppID:                  "1",
		AppSlug:                "agent",
		SealedGitHubPrivateKey: "sealed-pem",
		IdentityID:             "identity",
		ClientID:               "client",
		SealedClientSecret:     "sealed-secret",
		InstallationID:         "installation",
	}
	if err := writeAgentsInitState(path, state); err != nil {
		t.Fatal(err)
	}
	if _, err := readAgentsInitState(path); err != nil {
		t.Fatalf("complete checkpoint rejected: %v", err)
	}
	state.InstallationID = ""
	if err := writeAgentsInitState(path, state); err != nil {
		t.Fatal(err)
	}
	if _, err := readAgentsInitState(path); err == nil || !strings.Contains(err.Error(), "incomplete") {
		t.Fatalf("readAgentsInitState error = %v, want incomplete checkpoint", err)
	}
}

func TestAgentsInitCheckpointEncryptsOneTimeCredentials(t *testing.T) {
	keyPair, err := GenerateKeyPair()
	if err != nil {
		t.Fatal(err)
	}
	sealedPEM, err := EncryptForAgent("github-private-key", keyPair.PublicKey)
	if err != nil {
		t.Fatal(err)
	}
	sealedSecret, err := EncryptForAgent("oauth-client-secret", keyPair.PublicKey)
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), agentsInitStateFile)
	state := &agentsInitState{
		WorkflowID:             "workflow",
		ManifestURL:            "https://example.test",
		Phase:                  agentsInitPhaseRemoteComplete,
		AppID:                  "1",
		AppSlug:                "agent",
		SealedGitHubPrivateKey: sealedPEM,
		IdentityID:             "identity",
		ClientID:               "client",
		SealedClientSecret:     sealedSecret,
		InstallationID:         "installation",
	}
	if err := writeAgentsInitState(path, state); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(data), "github-private-key") || strings.Contains(string(data), "oauth-client-secret") {
		t.Fatalf("checkpoint contains plaintext one-time credentials: %s", data)
	}
	got, err := readAgentsInitState(path)
	if err != nil {
		t.Fatal(err)
	}
	for sealed, want := range map[string]string{
		got.SealedGitHubPrivateKey: "github-private-key",
		got.SealedClientSecret:     "oauth-client-secret",
	} {
		plaintext, decryptErr := DecryptFromAgent(sealed, keyPair.PrivateKey)
		if decryptErr != nil {
			t.Fatal(decryptErr)
		}
		if plaintext != want {
			t.Fatalf("decrypted checkpoint value = %q, want %q", plaintext, want)
		}
	}
}

func TestExchangeGitHubManifestHonorsContextDeadline(t *testing.T) {
	client := &http.Client{Transport: agentsInitRoundTripFunc(func(req *http.Request) (*http.Response, error) {
		<-req.Context().Done()
		return nil, req.Context().Err()
	})}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Millisecond)
	defer cancel()
	_, err := exchangeGitHubManifest(ctx, client, "one-time-code")
	if err == nil || !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("exchangeGitHubManifest error = %v, want deadline exceeded", err)
	}
}

func TestAgentInitComplete(t *testing.T) {
	complete := &CredentialsFile{
		IdentityID: "identity",
		OAuth2:     CredentialsOAuth2{ClientID: "client"},
		GitHub:     &GitHubSection{AppID: "app", InstallationID: "installation"},
	}
	if !agentInitRemoteComplete(complete) {
		t.Fatal("complete credentials were not recognized")
	}
	complete.GitHub.InstallationID = ""
	if agentInitRemoteComplete(complete) {
		t.Fatal("incomplete credentials were accepted")
	}
}
