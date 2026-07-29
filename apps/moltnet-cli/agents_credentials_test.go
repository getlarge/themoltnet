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

func TestPreflightCredentialsWriteRejectsMissingFile(t *testing.T) {
	t.Parallel()

	err := preflightCredentialsWrite(filepath.Join(t.TempDir(), "missing.json"))
	if err == nil || !strings.Contains(err.Error(), "stat") {
		t.Fatalf("error = %v, want missing-file preflight error", err)
	}
}

func newCredentialsRotationServer(
	t *testing.T,
	rotateCalls *atomic.Int32,
	responseClientID string,
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
				testNewClientSecret,
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
	return path
}
