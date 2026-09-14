package main

import (
	"bytes"
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
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
		SubjectID:              "00000000-0000-4000-8000-000000000022",
		SubjectType:            SubjectTypeAgent,
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
		SubjectID:              "00000000-0000-4000-8000-000000000022",
		SubjectType:            SubjectTypeAgent,
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
		SubjectID:   "00000000-0000-4000-8000-000000000022",
		SubjectType: SubjectTypeAgent,
		OAuth2:      CredentialsOAuth2{ClientID: "client"},
		GitHub:      &GitHubSection{AppID: "app", InstallationID: "installation"},
	}
	if !agentInitRemoteComplete(complete) {
		t.Fatal("complete credentials were not recognized")
	}
	complete.GitHub.InstallationID = ""
	if agentInitRemoteComplete(complete) {
		t.Fatal("incomplete credentials were accepted")
	}
}

func TestAgentsInitLegacyRemoteCheckpointIsRecoverable(t *testing.T) {
	path := filepath.Join(t.TempDir(), agentsInitStateFile)
	legacy := `{
  "workflowId": "workflow",
  "manifestUrl": "https://example.test",
  "phase": "remote_complete",
  "appId": "1",
  "appSlug": "agent",
  "sealedGitHubPrivateKey": "sealed-pem",
  "identityId": "00000000-0000-4000-8000-000000000011",
  "clientId": "client",
  "sealedClientSecret": "sealed-secret",
  "installationId": "installation"
}`
	if err := os.WriteFile(path, []byte(legacy), 0o600); err != nil {
		t.Fatal(err)
	}
	state, err := readAgentsInitState(path)
	if err != nil {
		t.Fatalf("legacy checkpoint rejected: %v", err)
	}
	if state.LegacyIdentityID == "" || state.SubjectID != "" || state.SubjectType != "" {
		t.Fatalf("legacy checkpoint decoded incorrectly: %#v", state)
	}
}

func TestAgentsInitCanonicalCheckpointOmitsIdentityID(t *testing.T) {
	path := filepath.Join(t.TempDir(), agentsInitStateFile)
	state := &agentsInitState{
		WorkflowID:             "workflow",
		Phase:                  agentsInitPhaseRemoteComplete,
		AppID:                  "1",
		AppSlug:                "agent",
		SealedGitHubPrivateKey: "sealed-pem",
		SubjectID:              "00000000-0000-4000-8000-000000000022",
		SubjectType:            SubjectTypeAgent,
		ClientID:               "client",
		SealedClientSecret:     "sealed-secret",
		InstallationID:         "installation",
	}
	if err := writeAgentsInitState(path, state); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(data), "identityId") {
		t.Fatalf("canonical checkpoint retained identityId:\n%s", data)
	}
}

func TestVerifyAgentsInitSubjectCanonicalizesLegacyCheckpoint(t *testing.T) {
	identityID := "00000000-0000-4000-8000-000000000011"
	subjectID := "00000000-0000-4000-8000-000000000022"
	server := newInitFromEnvWhoamiServer(t, identityID, subjectID, "agent")
	state := &agentsInitState{
		LegacyIdentityID: identityID,
		ClientID:         "client",
	}

	verified, err := verifyAgentsInitSubject(
		context.Background(), server.URL, "moltnet.json", state, "secret",
	)
	if err != nil {
		t.Fatalf("verify legacy checkpoint: %v", err)
	}
	if verified.SubjectID != subjectID || verified.SubjectType != SubjectTypeAgent {
		t.Fatalf("verified subject = %q/%q", verified.SubjectType, verified.SubjectID)
	}
}

func TestVerifyAgentsInitSubjectRejectsLegacyIdentityMismatch(t *testing.T) {
	server := newInitFromEnvWhoamiServer(
		t,
		"00000000-0000-4000-8000-000000000011",
		"00000000-0000-4000-8000-000000000022",
		"agent",
	)
	state := &agentsInitState{
		LegacyIdentityID: "00000000-0000-4000-8000-000000000099",
		ClientID:         "client",
	}

	_, err := verifyAgentsInitSubject(
		context.Background(), server.URL, "moltnet.json", state, "secret",
	)
	if err == nil || !strings.Contains(err.Error(), "does not match authenticated identity") {
		t.Fatalf("expected identity mismatch, got %v", err)
	}
}

func TestAssertIdentityDirContainedRejectsEscape(t *testing.T) {
	// Arrange: the identity leaf resolves outside the store, which is what a
	// symlink planted between prepareIdentityDirectory's Lstat and its MkdirAll
	// produces — MkdirAll succeeds through the link, so only this check sees it.
	root := t.TempDir()
	outside := t.TempDir()
	store := filepath.Join(root, "identities")
	if err := os.MkdirAll(store, 0o700); err != nil {
		t.Fatalf("create store: %v", err)
	}
	leaf := filepath.Join(store, "agent")
	if err := os.Symlink(outside, leaf); err != nil {
		t.Skipf("symlinks unavailable: %v", err)
	}

	// Act.
	err := assertIdentityDirContained(store, leaf)

	// Assert.
	if err == nil {
		t.Fatal("expected an escaping identity directory to be rejected")
	}
	if !strings.Contains(err.Error(), "escapes the central identity store") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestAssertIdentityDirContainedAcceptsSymlinkedAncestor(t *testing.T) {
	// Arrange: ~/.config symlinked elsewhere is a normal dotfile-manager setup
	// and must normalize, not fail. The caller resolves the root first, so the
	// containment check sees the real directory on both sides.
	real := t.TempDir()
	store := filepath.Join(real, "identities")
	leaf := filepath.Join(store, "agent")
	if err := os.MkdirAll(leaf, 0o700); err != nil {
		t.Fatalf("create leaf: %v", err)
	}
	linkedRoot := filepath.Join(t.TempDir(), "config")
	if err := os.Symlink(real, linkedRoot); err != nil {
		t.Skipf("symlinks unavailable: %v", err)
	}
	resolvedStore, err := filepath.EvalSymlinks(filepath.Join(linkedRoot, "identities"))
	if err != nil {
		t.Fatalf("resolve store: %v", err)
	}

	// Act.
	err = assertIdentityDirContained(resolvedStore, filepath.Join(linkedRoot, "identities", "agent"))

	// Assert.
	if err != nil {
		t.Fatalf("expected a symlinked ancestor to be accepted, got %v", err)
	}
}

// stubAgentsInitLocalSteps replaces the OS keyring with an in-memory provider
// and the local setup steps, which need GitHub, for the duration of a test.
// It returns the memory provider so a test can inspect stored secrets.
func stubAgentsInitLocalSteps(
	t *testing.T,
	complete func(agentsInitOpts, string, string, *CredentialsFile) error,
) *memorySecretProvider {
	t.Helper()
	providers, local := agentsInitSecretProviders, agentsInitCompleteLocal
	t.Cleanup(func() {
		agentsInitSecretProviders, agentsInitCompleteLocal = providers, local
	})
	registry, memory := newMemorySecretProviderRegistry()
	agentsInitSecretProviders = func() *SecretProviderRegistry { return registry }
	agentsInitCompleteLocal = complete
	return memory
}

func TestAgentsInitStoresSeedBeforeOnboardingAndKeepsItOnFailure(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	var seedStored, seedStoredBeforeRequest atomic.Bool
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		seedStoredBeforeRequest.Store(seedStored.Load())
		http.Error(w, `{"title":"unavailable","status":503}`, http.StatusServiceUnavailable)
	}))
	t.Cleanup(server.Close)
	memory := stubAgentsInitLocalSteps(t, func(agentsInitOpts, string, string, *CredentialsFile) error {
		t.Error("local setup must not run when onboarding fails")
		return nil
	})
	// Record the seed write in the provider's own goroutine; the fake server
	// only reads the atomic flag.
	memory.failSet = func(key string) error {
		if isIdentitySeedKey(key) {
			seedStored.Store(true)
		}
		return nil
	}

	err := runAgentsInitCmd(agentsInitOpts{
		apiURL: server.URL, apiURLExplicit: true, name: "init-fails",
		noOpen: true, timeout: 5 * time.Second,
		out: &bytes.Buffer{}, errOut: &bytes.Buffer{},
	})

	if err == nil {
		t.Fatal("expected onboarding to fail")
	}
	if !seedStoredBeforeRequest.Load() {
		t.Fatal("the identity seed was not stored before the onboarding request")
	}
	seeds := 0
	for key := range memory.values {
		if strings.HasPrefix(key, "identity/") {
			seeds++
		}
	}
	if seeds != 1 {
		t.Fatalf("stored seeds = %d, want the one seed kept after the failure", seeds)
	}
	if !strings.Contains(err.Error(), "seed kept at os-keyring:identity/") {
		t.Fatalf("error does not name the kept seed: %v", err)
	}
	path, pathErr := identityCredentialsPath("init-fails")
	if pathErr != nil {
		t.Fatal(pathErr)
	}
	if _, statErr := os.Stat(path); !os.IsNotExist(statErr) {
		t.Fatalf("config must not exist after a failed onboarding start: %v", statErr)
	}
}

func TestAgentsInitRefusesAnIdentityItDidNotStart(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	var requests atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		requests.Add(1)
		http.Error(w, "unexpected request", http.StatusInternalServerError)
	}))
	t.Cleanup(server.Close)
	memory := stubAgentsInitLocalSteps(t, func(agentsInitOpts, string, string, *CredentialsFile) error {
		t.Error("local setup must not run for a refused identity")
		return nil
	})
	path, err := identityCredentialsPath("from-register")
	if err != nil {
		t.Fatal(err)
	}
	existing := &CredentialsFile{
		SubjectID: "existing-subject", SubjectType: SubjectTypeAgent,
		OAuth2: CredentialsOAuth2{ClientID: "existing-client"},
		Keys:   CredentialsKeys{PublicKey: "ed25519:existing", Fingerprint: "EXIS-TING-0000-0000"},
	}
	if _, err := WriteConfigTo(existing, path); err != nil {
		t.Fatal(err)
	}
	before, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}

	err = runAgentsInitCmd(agentsInitOpts{
		apiURL: server.URL, apiURLExplicit: true, name: "from-register",
		noOpen: true, timeout: 5 * time.Second,
		out: &bytes.Buffer{}, errOut: &bytes.Buffer{},
	})

	if err == nil || !strings.Contains(err.Error(), "already exists") {
		t.Fatalf("error = %v, want existing-identity refusal", err)
	}
	if requests.Load() != 0 {
		t.Fatalf("network requests = %d, want 0", requests.Load())
	}
	after, readErr := os.ReadFile(path)
	if readErr != nil {
		t.Fatal(readErr)
	}
	if !bytes.Equal(before, after) {
		t.Fatal("the existing identity config was modified")
	}
	for key := range memory.values {
		if strings.HasPrefix(key, "identity/") {
			t.Fatalf("no seed may be generated for a refused identity, found %s", key)
		}
	}
}

func TestAgentsInitAlreadyInitializedDoesNotRepublishAlias(t *testing.T) {
	// Arrange: a remotely complete identity whose network alias was changed
	// elsewhere since this machine initialized it.
	f := newPublishFixture(t, "rerun-agent")
	f.handler.alias = "renamed-elsewhere"
	f.creds.GitHub = &GitHubSection{AppID: "1", InstallationID: "2"}
	if _, err := WriteConfigTo(f.creds, f.path); err != nil {
		t.Fatal(err)
	}
	completed := 0
	stubAgentsInitLocalSteps(t, func(agentsInitOpts, string, string, *CredentialsFile) error {
		completed++
		return nil
	})
	var stdout, stderr bytes.Buffer

	// Act
	err := runAgentsInitCmd(agentsInitOpts{
		name:           "rerun-agent",
		apiURL:         f.server.URL,
		apiURLExplicit: true,
		timeout:        5 * time.Second,
		out:            &stdout,
		errOut:         &stderr,
	})

	// Assert
	if err != nil {
		t.Fatalf("re-run init: %v\nstderr: %s", err, stderr.String())
	}
	if completed != 1 {
		t.Fatalf("local setup ran %d times, want 1", completed)
	}
	if !strings.Contains(stdout.String(), "Agent rerun-agent is already initialized") {
		t.Fatalf("unexpected stdout: %s", stdout.String())
	}
	if strings.Contains(stderr.String(), "network alias") {
		t.Fatalf("re-run init touched the network alias: %s", stderr.String())
	}
	if f.handler.whoamiCalls != 0 || len(f.handler.published) != 0 {
		t.Fatalf("re-run init contacted the API: whoami calls = %d, published = %v",
			f.handler.whoamiCalls, f.handler.published)
	}
}

func TestFinishCreatedAgentsInitPublishesAliasBestEffort(t *testing.T) {
	setupErr := errors.New("git setup failed")
	tests := []struct {
		name          string
		unreachable   bool
		completeErr   error
		wantErr       error
		wantStderr    string
		wantPublished int
	}{
		{
			name:          "publication succeeds",
			wantStderr:    "Published network alias created-agent",
			wantPublished: 1,
		},
		{
			name:        "publication failure does not fail init",
			unreachable: true,
			wantStderr:  "Warning: network alias publication failed",
		},
		{
			name:        "local setup failure skips publication",
			completeErr: setupErr,
			wantErr:     setupErr,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Arrange
			f := newPublishFixture(t, "created-agent")
			stubAgentsInitLocalSteps(t, func(agentsInitOpts, string, string, *CredentialsFile) error {
				return tt.completeErr
			})
			apiURL := f.server.URL
			if tt.unreachable {
				apiURL = "http://127.0.0.1:1"
			}
			var stderr bytes.Buffer
			opts := agentsInitOpts{name: "created-agent", timeout: 5 * time.Second, errOut: &stderr}

			// Act
			err := finishCreatedAgentsInit(opts, filepath.Dir(f.path), f.path, apiURL, f.creds)

			// Assert
			if !errors.Is(err, tt.wantErr) {
				t.Fatalf("err = %v, want %v", err, tt.wantErr)
			}
			if tt.wantStderr == "" && stderr.Len() != 0 {
				t.Fatalf("unexpected stderr: %s", stderr.String())
			}
			if !strings.Contains(stderr.String(), tt.wantStderr) {
				t.Fatalf("stderr = %q, want %q", stderr.String(), tt.wantStderr)
			}
			if len(f.handler.published) != tt.wantPublished {
				t.Fatalf("published aliases = %v, want %d", f.handler.published, tt.wantPublished)
			}
		})
	}
}
