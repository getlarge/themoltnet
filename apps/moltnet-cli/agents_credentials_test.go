package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
)

const (
	testOldClientSecret = "old-client-secret"
	testNewClientSecret = "new-client-secret"
)

func TestAgentsCredentialsRotateRequiresConfirmation(t *testing.T) {
	t.Parallel()

	root := NewRootCmd("test", "")
	_, _, err := executeCommand(
		root,
		"--credentials",
		filepath.Join(t.TempDir(), "missing.json"),
		"agents",
		"credentials",
		"rotate",
	)
	if err == nil || !strings.Contains(err.Error(), "--yes") {
		t.Fatalf("error = %v, want --yes confirmation error", err)
	}
}

func TestAgentsCredentialsRecoverRequiresConfirmation(t *testing.T) {
	t.Parallel()

	root := NewRootCmd("test", "")
	_, _, err := executeCommand(
		root,
		"--credentials",
		filepath.Join(t.TempDir(), "missing.json"),
		"agents",
		"credentials",
		"recover",
	)
	if err == nil || !strings.Contains(err.Error(), "--yes") {
		t.Fatalf("error = %v, want --yes confirmation error", err)
	}
}

func TestAgentsCredentialsRecoverPersistsSealedReplacement(t *testing.T) {
	keyPair, err := GenerateKeyPair()
	if err != nil {
		t.Fatalf("generate key pair: %v", err)
	}
	var challengeCalls atomic.Int32
	var recoveryCalls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(
		w http.ResponseWriter,
		r *http.Request,
	) {
		switch r.URL.Path {
		case "/recovery/challenge":
			challengeCalls.Add(1)
			var request struct {
				PublicKey string `json:"publicKey"`
				Purpose   string `json:"purpose"`
			}
			if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
				http.Error(w, "bad request", http.StatusBadRequest)
				return
			}
			if request.PublicKey != keyPair.PublicKey || request.Purpose != "credentials" {
				http.Error(w, "wrong public key", http.StatusBadRequest)
				return
			}
			w.Header().Set("Content-Type", "application/json")
			fmt.Fprintf(
				w,
				`{"challenge":%q,"hmac":%q}`,
				"moltnet:recovery:credentials:test-challenge",
				strings.Repeat("a", 64),
			)
		case "/recovery/credentials":
			recoveryCalls.Add(1)
			var request struct {
				Challenge string `json:"challenge"`
				PublicKey string `json:"publicKey"`
				Signature string `json:"signature"`
			}
			if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
				http.Error(w, "bad request", http.StatusBadRequest)
				return
			}
			if request.Challenge != "moltnet:recovery:credentials:test-challenge" ||
				request.PublicKey != keyPair.PublicKey ||
				request.Signature == "" {
				http.Error(w, "invalid proof", http.StatusBadRequest)
				return
			}
			sealed, err := EncryptForAgent(
				"recovered-client-secret",
				keyPair.PublicKey,
			)
			if err != nil {
				http.Error(w, "seal failed", http.StatusInternalServerError)
				return
			}
			w.Header().Set("Content-Type", "application/json")
			fmt.Fprintf(
				w,
				`{"clientId":"recovered-client-id","sealedClientSecret":%q}`,
				sealed,
			)
		case "/oauth2/token":
			if err := r.ParseForm(); err != nil {
				http.Error(w, "bad form", http.StatusBadRequest)
				return
			}
			if r.Form.Get("client_id") != "recovered-client-id" ||
				r.Form.Get("client_secret") != "recovered-client-secret" {
				http.Error(w, "invalid client", http.StatusUnauthorized)
				return
			}
			w.Header().Set("Content-Type", "application/json")
			fmt.Fprint(w, `{"access_token":"verified-token","token_type":"bearer","expires_in":3600}`)
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	credentialsPath := filepath.Join(t.TempDir(), "moltnet.json")
	credentials := &CredentialsFile{
		IdentityID: "identity-id",
		OAuth2: CredentialsOAuth2{
			ClientID:     "recovered-client-id",
			ClientSecret: "stale-client-secret",
		},
		Keys: CredentialsKeys{
			PublicKey:   keyPair.PublicKey,
			PrivateKey:  keyPair.PrivateKey,
			Fingerprint: keyPair.Fingerprint,
		},
		Endpoints: CredentialsEndpoints{API: server.URL},
	}
	if _, err := WriteConfigTo(credentials, credentialsPath); err != nil {
		t.Fatalf("write credentials: %v", err)
	}

	root := NewRootCmd("test", "")
	stdout, stderr, err := executeCommand(
		root,
		"--credentials",
		credentialsPath,
		"agents",
		"credentials",
		"recover",
		"--yes",
		"--destination", osKeyringProviderName,
	)
	if err != nil {
		t.Fatalf("recover: %v\nstderr: %s", err, stderr)
	}
	if challengeCalls.Load() != 1 || recoveryCalls.Load() != 1 {
		t.Fatalf(
			"challenge calls = %d, recovery calls = %d, want 1 each",
			challengeCalls.Load(),
			recoveryCalls.Load(),
		)
	}
	if strings.Contains(stdout, "recovered-client-secret") ||
		strings.Contains(stderr, "recovered-client-secret") {
		t.Fatal("recovered client secret leaked outside the credentials file")
	}

	updated, err := ReadConfigFrom(credentialsPath)
	if err != nil {
		t.Fatalf("read recovered credentials: %v", err)
	}
	if updated.OAuth2.ClientID != "recovered-client-id" ||
		updated.OAuth2.ClientSecret != "" || updated.OAuth2.ClientSecretRef == nil ||
		updated.OAuth2.ClientSecretRef.Provider != osKeyringProviderName {
		t.Fatalf("unexpected recovered credentials: %#v", updated.OAuth2)
	}
}

func TestAgentsCredentialsRecoverPreflightFailureBlocksNetwork(t *testing.T) {
	keyPair, err := GenerateKeyPair()
	if err != nil {
		t.Fatalf("generate key pair: %v", err)
	}
	var requests atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(
		w http.ResponseWriter,
		r *http.Request,
	) {
		requests.Add(1)
		http.Error(w, "unexpected request", http.StatusInternalServerError)
	}))
	defer server.Close()
	credentialsPath := writeRecoveryTestCredentials(
		t,
		keyPair,
		server.URL,
		CredentialsOAuth2{
			ClientID:     "recovered-client-id",
			ClientSecret: "lost-client-secret",
		},
	)

	err = runAgentsCredentialsRecoverCmd(agentsCredentialsRecoverOpts{
		credPath:    credentialsPath,
		yes:         true,
		destination: "not-a-provider",
	})

	if err == nil || !strings.Contains(err.Error(), "not a writable secret provider") {
		t.Fatalf("error = %v, want preflight failure", err)
	}
	if requests.Load() != 0 {
		t.Fatalf("network requests = %d, want 0", requests.Load())
	}
}

func TestAgentsCredentialsRecoverRejectsReadOnlyProviderBeforeNetwork(
	t *testing.T,
) {
	keyPair, err := GenerateKeyPair()
	if err != nil {
		t.Fatalf("generate key pair: %v", err)
	}
	var requests atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(
		w http.ResponseWriter,
		r *http.Request,
	) {
		requests.Add(1)
		http.Error(w, "unexpected request", http.StatusInternalServerError)
	}))
	defer server.Close()
	ref := &SecretReference{
		Provider: environmentProviderName,
		Key:      environmentSecretKey,
	}
	credentialsPath := writeRecoveryTestCredentials(
		t,
		keyPair,
		server.URL,
		CredentialsOAuth2{
			ClientID:        "recovered-client-id",
			ClientSecretRef: ref,
		},
	)

	err = runAgentsCredentialsRecoverCmd(agentsCredentialsRecoverOpts{
		credPath: credentialsPath,
		yes:      true,
	})

	if err == nil || !strings.Contains(err.Error(), "read-only") {
		t.Fatalf("error = %v, want read-only-provider failure", err)
	}
	if requests.Load() != 0 {
		t.Fatalf("network requests = %d, want 0", requests.Load())
	}
}

func TestAgentsCredentialsRecoverUpdatesReferencedSecret(t *testing.T) {
	keyPair, err := GenerateKeyPair()
	if err != nil {
		t.Fatalf("generate key pair: %v", err)
	}
	server := newCredentialsRecoveryServer(t, keyPair)
	defer server.Close()
	ref := &SecretReference{
		Provider: osKeyringProviderName,
		Key:      OAuth2SecretKey("identity-id", "recovered-client-id"),
	}
	credentialsPath := writeRecoveryTestCredentials(
		t,
		keyPair,
		server.URL,
		CredentialsOAuth2{
			ClientID:        "recovered-client-id",
			ClientSecretRef: ref,
		},
	)
	registry, provider := newMemorySecretProviderRegistry()
	provider.values[ref.Key] = "lost-client-secret"
	var stdout, stderr bytes.Buffer

	err = runAgentsCredentialsRecoverCmd(agentsCredentialsRecoverOpts{
		credPath:          credentialsPath,
		yes:               true,
		out:               &stdout,
		errOut:            &stderr,
		secretProviders:   registry,
		verifyCredentials: func(string, string, string) error { return nil },
	})

	if err != nil {
		t.Fatalf("recover referenced secret: %v", err)
	}
	if provider.values[ref.Key] != "recovered-client-secret" {
		t.Fatalf("stored secret = %q", provider.values[ref.Key])
	}
	if strings.Contains(stdout.String(), "recovered-client-secret") ||
		strings.Contains(stderr.String(), "recovered-client-secret") {
		t.Fatal("replacement secret leaked through command output")
	}
	if !strings.Contains(stderr.String(), osKeyringProviderName) {
		t.Fatalf("stderr = %q, want provider destination", stderr.String())
	}
}

func TestAgentsCredentialsRecoverPersistenceFailureEmitsRecoveryJSON(
	t *testing.T,
) {
	keyPair, err := GenerateKeyPair()
	if err != nil {
		t.Fatalf("generate key pair: %v", err)
	}
	server := newCredentialsRecoveryServer(t, keyPair)
	defer server.Close()
	credentialsPath := writeRecoveryTestCredentials(
		t,
		keyPair,
		server.URL,
		CredentialsOAuth2{
			ClientID:     "recovered-client-id",
			ClientSecret: "lost-client-secret",
		},
	)
	var stdout, stderr bytes.Buffer
	registry, _ := newMemorySecretProviderRegistry()

	err = runAgentsCredentialsRecoverCmd(agentsCredentialsRecoverOpts{
		credPath:             credentialsPath,
		yes:                  true,
		destination:          osKeyringProviderName,
		secretProviders:      registry,
		out:                  &stdout,
		errOut:               &stderr,
		reconcileCredentials: func(string, *CredentialsFile, SecretReference) error { return errors.New("persistence failed") },
		verifyCredentials:    func(string, string, string) error { return nil },
	})

	if err == nil {
		t.Fatal("expected persistence failure")
	}
	if strings.Contains(err.Error(), "recovered-client-secret") ||
		strings.Contains(stderr.String(), "recovered-client-secret") {
		t.Fatal("replacement secret leaked through error or stderr")
	}
	var output recoveredCredentialsOutput
	if decodeErr := json.Unmarshal(stdout.Bytes(), &output); decodeErr != nil {
		t.Fatalf("decode recovery output: %v", decodeErr)
	}
	if output.PersistenceState != "stored_config_pending" || !output.ManualRecoveryRequired || output.RecoveryPath == "" {
		t.Fatalf("unexpected recovery output: %#v", output)
	}
}

func TestAgentsCredentialsRecoverRejectsInvalidSealedResponses(t *testing.T) {
	keyPair, err := GenerateKeyPair()
	if err != nil {
		t.Fatalf("generate key pair: %v", err)
	}
	sealedEmpty, err := EncryptForAgent("", keyPair.PublicKey)
	if err != nil {
		t.Fatalf("seal empty secret: %v", err)
	}

	tests := []struct {
		name         string
		sealedSecret string
		wantError    string
	}{
		{name: "malformed envelope", sealedSecret: "not-an-envelope", wantError: "decrypt response"},
		{name: "empty secret", sealedSecret: sealedEmpty, wantError: "incomplete credential pair"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			server := newCredentialsRecoveryResponseServer(
				t,
				"recovered-client-id",
				tt.sealedSecret,
			)
			defer server.Close()
			credentialsPath := writeRecoveryTestCredentials(
				t,
				keyPair,
				server.URL,
				CredentialsOAuth2{
					ClientID:     "recovered-client-id",
					ClientSecret: "lost-client-secret",
				},
			)
			var stdout bytes.Buffer

			err := runAgentsCredentialsRecoverCmd(agentsCredentialsRecoverOpts{
				credPath:    credentialsPath,
				yes:         true,
				destination: osKeyringProviderName,
				out:         &stdout,
			})

			if err == nil || !strings.Contains(err.Error(), tt.wantError) {
				t.Fatalf("error = %v, want %q", err, tt.wantError)
			}
			if stdout.Len() != 0 {
				t.Fatalf("stdout = %q, want no unusable credential output", stdout.String())
			}
		})
	}
}

func TestAgentsCredentialsRecoverVerificationFailureEmitsRecoveryJSON(
	t *testing.T,
) {
	keyPair, err := GenerateKeyPair()
	if err != nil {
		t.Fatalf("generate key pair: %v", err)
	}
	server := newCredentialsRecoveryServer(t, keyPair)
	defer server.Close()
	credentialsPath := writeRecoveryTestCredentials(
		t,
		keyPair,
		server.URL,
		CredentialsOAuth2{
			ClientID:     "recovered-client-id",
			ClientSecret: "lost-client-secret",
		},
	)
	var stdout bytes.Buffer

	err = runAgentsCredentialsRecoverCmd(agentsCredentialsRecoverOpts{
		credPath:    credentialsPath,
		yes:         true,
		destination: osKeyringProviderName,
		out:         &stdout,
		verifyCredentials: func(string, string, string) error {
			return errors.New("token mint failed")
		},
	})

	if err == nil || !strings.Contains(err.Error(), "verify replacement OAuth2 credentials") {
		t.Fatalf("error = %v, want verification error", err)
	}
	if stdout.Len() != 0 {
		t.Fatalf("stdout = %q, want no secret-bearing recovery output", stdout.String())
	}
}

func TestAgentsCredentialsRotateNoUpdateRequiresSecretOutput(t *testing.T) {
	t.Parallel()

	root := NewRootCmd("test", "")
	_, _, err := executeCommand(
		root,
		"agents",
		"credentials",
		"rotate",
		"--yes",
		"--no-update",
	)
	if err == nil || !strings.Contains(err.Error(), "--show-secret") {
		t.Fatalf("error = %v, want --show-secret requirement", err)
	}
}

func TestResolveCredentialsPathPrecedence(t *testing.T) {
	tempDir := t.TempDir()
	explicitPath := filepath.Join(tempDir, "explicit.json")
	envPath := filepath.Join(tempDir, "env.json")
	agentDir := filepath.Join(tempDir, "agent")
	gitConfigPath := filepath.Join(agentDir, "gitconfig")
	gitSiblingPath := filepath.Join(agentDir, "moltnet.json")
	globalDir := filepath.Join(tempDir, ".config", "moltnet")
	globalPath := filepath.Join(globalDir, "moltnet.json")

	for _, path := range []string{
		explicitPath,
		envPath,
		gitConfigPath,
		gitSiblingPath,
		globalPath,
	} {
		if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
			t.Fatalf("mkdir %s: %v", path, err)
		}
		if err := os.WriteFile(path, []byte("{}"), 0o600); err != nil {
			t.Fatalf("write %s: %v", path, err)
		}
	}

	t.Setenv("HOME", tempDir)
	t.Setenv("MOLTNET_CREDENTIALS_PATH", envPath)
	t.Setenv("GIT_CONFIG_GLOBAL", gitConfigPath)

	got, err := resolveCredentialsPath(explicitPath)
	if err != nil || got != explicitPath {
		t.Fatalf("explicit path = %q, %v; want %q", got, err, explicitPath)
	}

	got, err = resolveCredentialsPath("")
	if err != nil || got != envPath {
		t.Fatalf("env path = %q, %v; want %q", got, err, envPath)
	}

	t.Setenv("MOLTNET_CREDENTIALS_PATH", "")
	got, err = resolveCredentialsPath("")
	if err != nil || got != gitSiblingPath {
		t.Fatalf(
			"GIT_CONFIG_GLOBAL sibling = %q, %v; want %q",
			got,
			err,
			gitSiblingPath,
		)
	}

	t.Setenv("GIT_CONFIG_GLOBAL", "")
	got, err = resolveCredentialsPath("")
	if err != nil || got != globalPath {
		t.Fatalf("global path = %q, %v; want %q", got, err, globalPath)
	}
}

func TestResolveCredentialsPathAnchorsRelativeGitConfigToRepository(
	t *testing.T,
) {
	repoDir := t.TempDir()
	if output, err := exec.Command("git", "init", repoDir).CombinedOutput(); err != nil {
		t.Fatalf("git init: %v: %s", err, output)
	}
	agentDir := filepath.Join(repoDir, ".moltnet", "agent")
	if err := os.MkdirAll(agentDir, 0o700); err != nil {
		t.Fatalf("create agent dir: %v", err)
	}
	credentialsPath := filepath.Join(agentDir, "moltnet.json")
	if err := os.WriteFile(credentialsPath, []byte("{}"), privateFileMode); err != nil {
		t.Fatalf("write credentials: %v", err)
	}

	previousDir, err := os.Getwd()
	if err != nil {
		t.Fatalf("get working directory: %v", err)
	}
	subdir := filepath.Join(repoDir, "nested")
	if err := os.Mkdir(subdir, 0o700); err != nil {
		t.Fatalf("create nested directory: %v", err)
	}
	if err := os.Chdir(subdir); err != nil {
		t.Fatalf("change directory: %v", err)
	}
	t.Cleanup(func() {
		if err := os.Chdir(previousDir); err != nil {
			t.Errorf("restore working directory: %v", err)
		}
	})
	t.Setenv("MOLTNET_CREDENTIALS_PATH", "")
	t.Setenv("GIT_CONFIG_GLOBAL", ".moltnet/agent/gitconfig")

	got, err := resolveCredentialsPath("")

	if err != nil {
		t.Fatalf("resolve credentials: %v", err)
	}
	resolvedRepoDir, err := filepath.EvalSymlinks(repoDir)
	if err != nil {
		t.Fatalf("resolve repository path: %v", err)
	}
	want := filepath.Join(resolvedRepoDir, ".moltnet", "agent", "moltnet.json")
	if got != want {
		t.Fatalf("credentials path = %q, want %q", got, want)
	}
}

func TestAgentsCredentialsRotateRejectsIncompleteLocalCredentialsBeforeNetwork(
	t *testing.T,
) {
	var requests atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(
		w http.ResponseWriter,
		r *http.Request,
	) {
		requests.Add(1)
		http.Error(w, "unexpected request", http.StatusInternalServerError)
	}))
	defer server.Close()

	tests := []struct {
		name         string
		clientID     string
		clientSecret string
		wantError    string
	}{
		{name: "missing client ID", clientSecret: testOldClientSecret, wantError: "missing client_id"},
		{name: "missing client secret", clientID: "client-id", wantError: "exactly one"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			credentialsPath := filepath.Join(t.TempDir(), "moltnet.json")
			data := fmt.Sprintf(
				`{"oauth2":{"client_id":%q,"client_secret":%q},"endpoints":{"api":%q}}`,
				tt.clientID,
				tt.clientSecret,
				server.URL,
			)
			if err := os.WriteFile(
				credentialsPath,
				[]byte(data),
				privateFileMode,
			); err != nil {
				t.Fatalf("write credentials: %v", err)
			}
			root := NewRootCmd("test", "")

			_, _, err := executeCommand(
				root,
				"--credentials",
				credentialsPath,
				"agents",
				"credentials",
				"rotate",
				"--yes",
			)

			if err == nil || !strings.Contains(err.Error(), tt.wantError) {
				t.Fatalf("error = %v, want incomplete credentials error", err)
			}
		})
	}
	if requests.Load() != 0 {
		t.Fatalf("network requests = %d, want 0", requests.Load())
	}
}

func TestAgentsCredentialsRotateUsesEndpointFromResolvedCredentials(
	t *testing.T,
) {
	var rotateCalls atomic.Int32
	server := newCredentialsRotationServer(t, &rotateCalls, "client-id")
	defer server.Close()

	repoDir := t.TempDir()
	if output, err := exec.Command("git", "init", repoDir).CombinedOutput(); err != nil {
		t.Fatalf("git init: %v: %s", err, output)
	}
	agentDir := filepath.Join(repoDir, ".moltnet", "agent")
	if err := os.MkdirAll(agentDir, 0o700); err != nil {
		t.Fatalf("create agent dir: %v", err)
	}
	credentialsPath := filepath.Join(agentDir, "moltnet.json")
	writeRotationTestCredentialsTo(
		t,
		credentialsPath,
		server.URL,
		testOldClientSecret,
	)

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
	t.Setenv(apiURLEnv, "")
	t.Setenv("MOLTNET_CREDENTIALS_PATH", "")
	t.Setenv("GIT_CONFIG_GLOBAL", ".moltnet/agent/gitconfig")

	root := NewRootCmd("test", "")
	_, stderr, err := executeCommand(
		root,
		"agents",
		"credentials",
		"rotate",
		"--yes",
	)

	if err != nil {
		t.Fatalf("rotate: %v\nstderr: %s", err, stderr)
	}
	if rotateCalls.Load() != 1 {
		t.Fatalf("rotate calls = %d, want 1", rotateCalls.Load())
	}
}

func TestAgentsCredentialsRotatePersistsWithoutDisclosingSecret(t *testing.T) {
	var rotateCalls atomic.Int32
	server := newCredentialsRotationServer(t, &rotateCalls, "client-id")
	defer server.Close()

	credentialsPath := writeRotationTestCredentials(
		t,
		server.URL,
		testOldClientSecret,
	)
	t.Setenv(agentKeyEnv, "agent-key-that-must-be-ignored")
	t.Setenv("MOLTNET_CREDENTIALS_PATH", credentialsPath)

	root := NewRootCmd("test", "")
	stdout, stderr, err := executeCommand(
		root,
		"agents",
		"credentials",
		"rotate",
		"--yes",
	)
	if err != nil {
		t.Fatalf("rotate: %v\nstderr: %s", err, stderr)
	}
	if rotateCalls.Load() != 1 {
		t.Fatalf("rotate calls = %d, want 1", rotateCalls.Load())
	}
	if strings.Contains(stdout, testNewClientSecret) ||
		strings.Contains(stderr, testNewClientSecret) {
		t.Fatal("new client secret leaked outside the credentials file")
	}

	var output rotateCredentialsOutput
	if err := json.Unmarshal([]byte(stdout), &output); err != nil {
		t.Fatalf("parse stdout: %v\n%s", err, stdout)
	}
	if output.ClientID != "client-id" ||
		output.CredentialsPath != credentialsPath ||
		!output.CredentialsUpdated ||
		output.ClientSecret != "" {
		t.Fatalf("unexpected output: %#v", output)
	}

	data, err := os.ReadFile(credentialsPath)
	if err != nil {
		t.Fatalf("read updated credentials: %v", err)
	}
	if !bytes.Contains(data, []byte(testNewClientSecret)) {
		t.Fatal("updated credentials do not contain the new secret")
	}
	var document map[string]json.RawMessage
	if err := json.Unmarshal(data, &document); err != nil {
		t.Fatalf("parse updated credentials: %v", err)
	}
	var custom struct {
		Preserved bool `json:"preserved"`
	}
	if err := json.Unmarshal(document["custom"], &custom); err != nil ||
		!custom.Preserved {
		t.Fatalf(
			"unknown top-level field was not preserved: %s (%v)",
			document["custom"],
			err,
		)
	}
	var oauth2 map[string]json.RawMessage
	if err := json.Unmarshal(document["oauth2"], &oauth2); err != nil {
		t.Fatalf("parse updated oauth2: %v", err)
	}
	if string(oauth2["audience"]) != `"preserved"` {
		t.Fatalf("unknown oauth2 field was not preserved: %s", oauth2["audience"])
	}
	info, err := os.Stat(credentialsPath)
	if err != nil {
		t.Fatalf("stat updated credentials: %v", err)
	}
	if got := info.Mode().Perm(); got != 0o600 {
		t.Fatalf("credentials mode = %o, want 600", got)
	}
}

func TestAgentsCredentialsRotateNoUpdateShowsSecret(t *testing.T) {
	var rotateCalls atomic.Int32
	server := newCredentialsRotationServer(t, &rotateCalls, "client-id")
	defer server.Close()

	credentialsPath := writeRotationTestCredentials(
		t,
		server.URL,
		testOldClientSecret,
	)
	before, err := os.ReadFile(credentialsPath)
	if err != nil {
		t.Fatalf("read credentials before rotation: %v", err)
	}

	root := NewRootCmd("test", "")
	stdout, stderr, err := executeCommand(
		root,
		"--credentials",
		credentialsPath,
		"agents",
		"credentials",
		"rotate",
		"--yes",
		"--no-update",
		"--show-secret",
	)
	if err != nil {
		t.Fatalf("rotate: %v\nstderr: %s", err, stderr)
	}
	if !strings.Contains(stdout, testNewClientSecret) {
		t.Fatal("--show-secret output does not contain the new secret")
	}
	after, err := os.ReadFile(credentialsPath)
	if err != nil {
		t.Fatalf("read credentials after rotation: %v", err)
	}
	if !bytes.Equal(before, after) {
		t.Fatal("--no-update changed the credentials file")
	}
}

func TestAgentsCredentialsRotatePersistenceFailureEmitsRecoveryJSON(t *testing.T) {
	var rotateCalls atomic.Int32
	server := newCredentialsRotationServer(t, &rotateCalls, "client-id")
	defer server.Close()

	client, err := newBearerClient(
		server.URL,
		func(_ context.Context) (string, error) {
			return "access-token", nil
		},
		server.Client(),
	)
	if err != nil {
		t.Fatalf("create client: %v", err)
	}
	document := map[string]json.RawMessage{
		"oauth2": json.RawMessage(
			`{"client_id":"client-id","client_secret":"old-client-secret"}`,
		),
	}
	var stdout, stderr bytes.Buffer
	err = runAgentsCredentialsRotateWithClient(
		context.Background(),
		client,
		"/safe/path/moltnet.json",
		document,
		"client-id",
		agentsCredentialsRotateOpts{
			out:    &stdout,
			errOut: &stderr,
			writeCredentials: func(_ string, _ []byte) error {
				return errors.New("diagnostic contains " + testNewClientSecret)
			},
		},
	)
	if err == nil {
		t.Fatal("expected persistence failure")
	}
	if strings.Contains(err.Error(), testNewClientSecret) ||
		strings.Contains(stderr.String(), testNewClientSecret) {
		t.Fatal("new client secret leaked through an error or stderr")
	}
	if !strings.Contains(stderr.String(), "Capture stdout") {
		t.Fatalf("stderr = %q, want recovery notice", stderr.String())
	}

	var output rotateCredentialsOutput
	if decodeErr := json.Unmarshal(stdout.Bytes(), &output); decodeErr != nil {
		t.Fatalf("parse recovery JSON: %v\n%s", decodeErr, stdout.String())
	}
	if output.CredentialsUpdated ||
		output.ClientSecret != testNewClientSecret ||
		output.CredentialsPath != "/safe/path/moltnet.json" {
		t.Fatalf("unexpected recovery output: %#v", output)
	}
}

func TestAgentsCredentialsRotateUpdatesReferencedSecret(t *testing.T) {
	var rotateCalls atomic.Int32
	server := newCredentialsRotationServer(t, &rotateCalls, "client-id")
	defer server.Close()
	client, err := newBearerClient(
		server.URL,
		func(_ context.Context) (string, error) { return "access-token", nil },
		server.Client(),
	)
	if err != nil {
		t.Fatalf("create client: %v", err)
	}
	key := OAuth2SecretKey("identity-id", "client-id")
	ref := SecretReference{Provider: osKeyringProviderName, Key: key}
	registry, provider := newMemorySecretProviderRegistry()
	provider.values[key] = testOldClientSecret
	document := map[string]json.RawMessage{
		"oauth2": json.RawMessage(
			`{"client_id":"client-id","client_secret_ref":{"provider":"os-keyring","key":"oauth2/identity-id/client-id"}}`,
		),
	}
	var stdout bytes.Buffer

	err = runAgentsCredentialsRotateWithClient(
		context.Background(),
		client,
		"/safe/path/moltnet.json",
		document,
		"client-id",
		agentsCredentialsRotateOpts{
			out:             &stdout,
			secretReference: &ref,
			secretProviders: registry,
			writeCredentials: func(_ string, _ []byte) error {
				t.Fatal("referenced rotation rewrote the credentials file")
				return nil
			},
		},
	)

	if err != nil {
		t.Fatalf("rotate referenced secret: %v", err)
	}
	if provider.values[key] != testNewClientSecret {
		t.Fatalf("stored secret = %q, want rotated secret", provider.values[key])
	}
	if strings.Contains(stdout.String(), testNewClientSecret) {
		t.Fatal("rotated secret leaked to stdout")
	}
}

func TestAgentsCredentialsRotateStdoutFailureWritesProtectedRecoveryFile(
	t *testing.T,
) {
	var rotateCalls atomic.Int32
	server := newCredentialsRotationServer(t, &rotateCalls, "client-id")
	defer server.Close()

	client, err := newBearerClient(
		server.URL,
		func(_ context.Context) (string, error) {
			return "access-token", nil
		},
		server.Client(),
	)
	if err != nil {
		t.Fatalf("create client: %v", err)
	}
	document := map[string]json.RawMessage{
		"oauth2": json.RawMessage(
			`{"client_id":"client-id","client_secret":"old-client-secret"}`,
		),
	}
	recoveryDir := t.TempDir()
	var stderr bytes.Buffer
	var recoveryPath string
	err = runAgentsCredentialsRotateWithClient(
		context.Background(),
		client,
		"/safe/path/moltnet.json",
		document,
		"client-id",
		agentsCredentialsRotateOpts{
			out:    failingWriter{},
			errOut: &stderr,
			writeCredentials: func(_ string, _ []byte) error {
				return errors.New("diagnostic contains " + testNewClientSecret)
			},
			writeRecoveryFile: func(
				output rotateCredentialsOutput,
			) (string, error) {
				var writeErr error
				recoveryPath, writeErr =
					writeCredentialsRecoveryFileToDir(recoveryDir, output)
				return recoveryPath, writeErr
			},
		},
	)

	if err == nil {
		t.Fatal("expected persistence and stdout failure")
	}
	if recoveryPath == "" {
		t.Fatal("protected recovery file was not created")
	}
	if strings.Contains(err.Error(), testNewClientSecret) ||
		strings.Contains(stderr.String(), testNewClientSecret) {
		t.Fatal("new client secret leaked through an error or stderr")
	}
	if !strings.Contains(err.Error(), recoveryPath) ||
		!strings.Contains(stderr.String(), recoveryPath) {
		t.Fatalf(
			"recovery path not reported: error=%q stderr=%q",
			err,
			stderr.String(),
		)
	}
	data, readErr := os.ReadFile(recoveryPath)
	if readErr != nil {
		t.Fatalf("read recovery file: %v", readErr)
	}
	var output rotateCredentialsOutput
	if err := json.Unmarshal(data, &output); err != nil {
		t.Fatalf("parse recovery file: %v", err)
	}
	if output.ClientSecret != testNewClientSecret ||
		output.CredentialsUpdated {
		t.Fatalf("unexpected recovery output: %#v", output)
	}
	info, statErr := os.Stat(recoveryPath)
	if statErr != nil {
		t.Fatalf("stat recovery file: %v", statErr)
	}
	if got := info.Mode().Perm(); got != privateFileMode {
		t.Fatalf("recovery mode = %o, want %o", got, privateFileMode)
	}
}

func TestAgentsCredentialsRotateRejectsUnexpectedClientIDWithRecovery(t *testing.T) {
	var rotateCalls atomic.Int32
	server := newCredentialsRotationServer(
		t,
		&rotateCalls,
		"unexpected-client-id",
	)
	defer server.Close()

	client, err := newBearerClient(
		server.URL,
		func(_ context.Context) (string, error) {
			return "access-token", nil
		},
		server.Client(),
	)
	if err != nil {
		t.Fatalf("create client: %v", err)
	}
	document := map[string]json.RawMessage{
		"oauth2": json.RawMessage(
			`{"client_id":"client-id","client_secret":"old-client-secret"}`,
		),
	}
	var stdout, stderr bytes.Buffer
	err = runAgentsCredentialsRotateWithClient(
		context.Background(),
		client,
		"/safe/path/moltnet.json",
		document,
		"client-id",
		agentsCredentialsRotateOpts{
			out:    &stdout,
			errOut: &stderr,
		},
	)
	if err == nil {
		t.Fatal("expected unexpected-client-ID failure")
	}
	if strings.Contains(err.Error(), testNewClientSecret) ||
		strings.Contains(stderr.String(), testNewClientSecret) {
		t.Fatal("new client secret leaked through an error or stderr")
	}
	var output rotateCredentialsOutput
	if decodeErr := json.Unmarshal(stdout.Bytes(), &output); decodeErr != nil {
		t.Fatalf("parse recovery JSON: %v\n%s", decodeErr, stdout.String())
	}
	if output.ClientID != "unexpected-client-id" ||
		output.ClientSecret != testNewClientSecret ||
		output.CredentialsUpdated {
		t.Fatalf("unexpected recovery output: %#v", output)
	}
}

func TestAgentsCredentialsRotateRejectsIncompleteServerCredentials(t *testing.T) {
	var rotateCalls atomic.Int32
	server := newCredentialsRotationServerResponse(
		t,
		&rotateCalls,
		"client-id",
		"",
	)
	defer server.Close()

	client, err := newBearerClient(
		server.URL,
		func(_ context.Context) (string, error) {
			return "access-token", nil
		},
		server.Client(),
	)
	if err != nil {
		t.Fatalf("create client: %v", err)
	}
	var stdout bytes.Buffer

	err = runAgentsCredentialsRotateWithClient(
		context.Background(),
		client,
		"/safe/path/moltnet.json",
		map[string]json.RawMessage{},
		"client-id",
		agentsCredentialsRotateOpts{out: &stdout},
	)

	if err == nil || !strings.Contains(err.Error(), "incomplete credential pair") {
		t.Fatalf("error = %v, want incomplete credential pair", err)
	}
	if rotateCalls.Load() != 1 {
		t.Fatalf("rotate calls = %d, want 1", rotateCalls.Load())
	}
	if stdout.Len() != 0 {
		t.Fatalf("stdout = %q, want empty", stdout.String())
	}
}

func TestAgentsCredentialsRotatePreflightFailureBlocksNetwork(t *testing.T) {
	var requests atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(
		w http.ResponseWriter,
		r *http.Request,
	) {
		requests.Add(1)
		http.Error(w, "unexpected request", http.StatusInternalServerError)
	}))
	defer server.Close()
	credentialsPath := writeRotationTestCredentials(
		t,
		server.URL,
		testOldClientSecret,
	)

	err := runAgentsCredentialsRotateCmd(agentsCredentialsRotateOpts{
		apiURL:   server.URL,
		credPath: credentialsPath,
		yes:      true,
		preflightCredentials: func(string) error {
			return errors.New("unsafe destination")
		},
	})

	if err == nil || !strings.Contains(err.Error(), "rotation was not attempted") {
		t.Fatalf("error = %v, want preflight failure", err)
	}
	if requests.Load() != 0 {
		t.Fatalf("network requests = %d, want 0", requests.Load())
	}
}

func TestPreflightCredentialsWriteRejectsMissingFile(t *testing.T) {
	t.Parallel()

	err := preflightCredentialsWrite(filepath.Join(t.TempDir(), "missing.json"))
	if err == nil || !strings.Contains(err.Error(), "stat") {
		t.Fatalf("error = %v, want missing-file preflight error", err)
	}
}

func TestUpdateCredentialsDocumentDoesNotMutateInput(t *testing.T) {
	originalOAuth := json.RawMessage(
		`{"client_id":"client-id","client_secret":"old-client-secret"}`,
	)
	document := map[string]json.RawMessage{
		"oauth2": originalOAuth,
		"custom": json.RawMessage(`{"preserved":true}`),
	}

	_, err := updateCredentialsDocument(
		document,
		"client-id",
		testNewClientSecret,
	)

	if err != nil {
		t.Fatalf("update credentials: %v", err)
	}
	if !bytes.Equal(document["oauth2"], originalOAuth) {
		t.Fatalf("input oauth2 mutated: %s", document["oauth2"])
	}
}

func TestWriteFileAtomicRemovesTempFileAfterRenameFailure(t *testing.T) {
	parent := t.TempDir()
	target := filepath.Join(parent, "existing-directory")
	if err := os.Mkdir(target, 0o700); err != nil {
		t.Fatalf("create rename target: %v", err)
	}

	err := writeFileAtomic(
		target,
		[]byte("secret"),
	)

	if err == nil {
		t.Fatal("expected rename failure")
	}
	matches, globErr := filepath.Glob(
		filepath.Join(parent, ".existing-directory*"),
	)
	if globErr != nil {
		t.Fatalf("glob temporary files: %v", globErr)
	}
	if len(matches) != 0 {
		t.Fatalf("temporary files were not removed: %v", matches)
	}
}

func newCredentialsRotationServer(
	t *testing.T,
	rotateCalls *atomic.Int32,
	responseClientID string,
) *httptest.Server {
	return newCredentialsRotationServerResponse(
		t,
		rotateCalls,
		responseClientID,
		testNewClientSecret,
	)
}

func newCredentialsRecoveryServer(
	t *testing.T,
	keyPair *KeyPair,
) *httptest.Server {
	t.Helper()
	sealed, err := EncryptForAgent(
		"recovered-client-secret",
		keyPair.PublicKey,
	)
	if err != nil {
		t.Fatalf("seal replacement secret: %v", err)
	}
	return newCredentialsRecoveryResponseServer(
		t,
		"recovered-client-id",
		sealed,
	)
}

func newCredentialsRecoveryResponseServer(
	t *testing.T,
	clientID string,
	sealedSecret string,
) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(
		w http.ResponseWriter,
		r *http.Request,
	) {
		switch r.URL.Path {
		case "/recovery/challenge":
			w.Header().Set("Content-Type", "application/json")
			fmt.Fprintf(
				w,
				`{"challenge":%q,"hmac":%q}`,
				"moltnet:recovery:credentials:test-challenge",
				strings.Repeat("a", 64),
			)
		case "/recovery/credentials":
			w.Header().Set("Content-Type", "application/json")
			fmt.Fprintf(
				w,
				`{"clientId":%q,"sealedClientSecret":%q}`,
				clientID,
				sealedSecret,
			)
		default:
			http.NotFound(w, r)
		}
	}))
}

func writeRecoveryTestCredentials(
	t *testing.T,
	keyPair *KeyPair,
	apiURL string,
	oauth2 CredentialsOAuth2,
) string {
	t.Helper()
	credentialsPath := filepath.Join(t.TempDir(), "moltnet.json")
	credentials := &CredentialsFile{
		IdentityID: "identity-id",
		OAuth2:     oauth2,
		Keys: CredentialsKeys{
			PublicKey:   keyPair.PublicKey,
			PrivateKey:  keyPair.PrivateKey,
			Fingerprint: keyPair.Fingerprint,
		},
		Endpoints: CredentialsEndpoints{API: apiURL},
	}
	if _, err := WriteConfigTo(credentials, credentialsPath); err != nil {
		t.Fatalf("write recovery credentials: %v", err)
	}
	return credentialsPath
}

func newCredentialsRotationServerResponse(
	t *testing.T,
	rotateCalls *atomic.Int32,
	responseClientID string,
	responseClientSecret string,
) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(
		w http.ResponseWriter,
		r *http.Request,
	) {
		switch r.URL.Path {
		case "/oauth2/token":
			if err := r.ParseForm(); err != nil {
				http.Error(w, "parse form", http.StatusBadRequest)
				return
			}
			if r.Form.Get("client_id") != "client-id" ||
				r.Form.Get("client_secret") != testOldClientSecret {
				http.Error(w, "invalid client credentials", http.StatusUnauthorized)
				return
			}
			w.Header().Set("Content-Type", "application/json")
			fmt.Fprint(
				w,
				`{"access_token":"access-token","token_type":"Bearer","expires_in":300}`,
			)
		case "/auth/rotate-secret":
			if r.Method != http.MethodPost {
				http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
				return
			}
			if r.Header.Get("Authorization") != "Bearer access-token" {
				http.Error(w, "unauthorized", http.StatusUnauthorized)
				return
			}
			rotateCalls.Add(1)
			w.Header().Set("Content-Type", "application/json")
			fmt.Fprintf(
				w,
				`{"clientId":%q,"clientSecret":%q}`,
				responseClientID,
				responseClientSecret,
			)
		default:
			http.NotFound(w, r)
		}
	}))
}

func writeRotationTestCredentials(
	t *testing.T,
	apiURL string,
	clientSecret string,
) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "moltnet.json")
	writeRotationTestCredentialsTo(t, path, apiURL, clientSecret)
	return path
}

func writeRotationTestCredentialsTo(
	t *testing.T,
	path string,
	apiURL string,
	clientSecret string,
) {
	t.Helper()
	data := fmt.Sprintf(`{
  "identity_id": "identity-id",
  "oauth2": {
    "client_id": "client-id",
    "client_secret": %q,
    "audience": "preserved"
  },
  "keys": {
    "public_key": "public",
    "private_key": "private",
    "fingerprint": "fingerprint"
  },
  "endpoints": {
    "api": %q,
    "mcp": "https://mcp.example.test"
  },
  "registered_at": "2026-01-01T00:00:00Z",
  "custom": {
    "preserved": true
  }
}
`, clientSecret, apiURL)
	if err := os.WriteFile(path, []byte(data), 0o600); err != nil {
		t.Fatalf("write credentials: %v", err)
	}
}

type failingWriter struct{}

func (failingWriter) Write([]byte) (int, error) {
	return 0, errors.New("write failed")
}
