package main

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

func TestConfigInitFromEnvSessionKey(t *testing.T) {
	for _, tc := range []struct {
		name, subject, publicKey, subjectType, seed string
		status                                      int
		envFile, oauth                              bool
		wantErr                                     string
	}{
		{name: "key only"},
		{name: "env file", envFile: true},
		{name: "key overrides OAuth", oauth: true},
		{name: "wrong subject", subject: altSubjectID, wantErr: "MOLTNET_SUBJECT_ID does not match"},
		{name: "wrong seed", seed: altPrivateKey, wantErr: "seed does not derive"},
		{name: "wrong public key", publicKey: altPublicKey, wantErr: "MOLTNET_PUBLIC_KEY does not match"},
		{name: "human", subjectType: "human", wantErr: "not as an agent"},
		{name: "expired or revoked", status: http.StatusUnauthorized, wantErr: "replace an expired or revoked key"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			clearMoltnetEnv(t)
			home := t.TempDir()
			setTestHome(t, home)
			const sessionKey = "session-test-key"
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path != "/agents/whoami" {
					t.Errorf("unexpected path %s", r.URL.Path)
					w.WriteHeader(404)
					return
				}
				if r.Header.Get("Authorization") != "Bearer "+sessionKey {
					t.Error("wrong credential")
				}
				w.Header().Set("Content-Type", "application/json")
				if tc.status != 0 {
					w.WriteHeader(tc.status)
					_, _ = io.WriteString(w, `{"type":"about:blank","title":"Unauthorized","status":401,"detail":"Credential rejected"}`)
					return
				}
				subject, publicKey, subjectType := tc.subject, tc.publicKey, tc.subjectType
				if subject == "" {
					subject = testSubjectID
				}
				if publicKey == "" {
					publicKey = testPublicKey
				}
				if subjectType == "" {
					subjectType = "agent"
				}
				_ = json.NewEncoder(w).Encode(map[string]any{"subjectId": subject, "subjectType": subjectType, "identityId": testSubjectID, "publicKey": publicKey, "scopes": []string{"agent:profile"}})
			}))
			defer server.Close()
			vars := map[string]string{
				"MOLTNET_SUBJECT_ID":   testSubjectID,
				"MOLTNET_SUBJECT_TYPE": "agent",
				"MOLTNET_PUBLIC_KEY":   testPublicKey,
				"MOLTNET_PRIVATE_KEY":  testPrivateKey,
				"MOLTNET_FINGERPRINT":  "A1B2-C3D4-E5F6-A1B2",
				"MOLTNET_API_URL":      server.URL,
				agentKeyEnv:            sessionKey,
				"MOLTNET_GIT_EMAIL":    "session@example.com",
			}
			if tc.name == "key only" {
				vars["MOLTNET_GITHUB_APP_ID"] = "123"
				vars["MOLTNET_GITHUB_APP_INSTALLATION_ID"] = "456"
				vars["MOLTNET_GITHUB_APP_PRIVATE_KEY"] = string(testRSAPrivateKeyPEM(t))
			}
			if tc.seed != "" {
				vars["MOLTNET_PRIVATE_KEY"] = tc.seed
			}
			envFile := ""
			if tc.envFile {
				var contents strings.Builder
				for k, v := range vars {
					contents.WriteString(k + "=" + v + "\n")
				}
				envFile = filepath.Join(home, "session.env")
				if err := os.WriteFile(envFile, []byte(contents.String()), 0600); err != nil {
					t.Fatal(err)
				}
			} else {
				for k, v := range vars {
					t.Setenv(k, v)
				}
			}
			if tc.oauth {
				t.Setenv("MOLTNET_CLIENT_ID", "unused-client")
				t.Setenv("MOLTNET_CLIENT_SECRET", "unused-secret")
			}
			var progress bytes.Buffer
			registry, _ := newMemorySecretProviderRegistry()
			err := runConfigInitFromEnvCmdWithRegistry(&progress, "", "session", false, envFile, false, registry, defaultMigrationDestination)
			dir := filepath.Join(home, ".config", "moltnet", "identities", "session")
			if tc.wantErr != "" {
				if err == nil || !strings.Contains(err.Error(), tc.wantErr) {
					t.Fatalf("want %q, got %v", tc.wantErr, err)
				}
				if _, statErr := os.Stat(dir); !os.IsNotExist(statErr) {
					t.Fatalf("rejected key left identity assets: %v", statErr)
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			if progress.String() == "" {
				t.Fatal("missing progress")
			}
			configPath := filepath.Join(dir, "moltnet.json")
			config, err := ReadConfigFrom(configPath)
			if err != nil {
				t.Fatal(err)
			}
			data, err := os.ReadFile(configPath)
			if err != nil {
				t.Fatal(err)
			}
			if bytes.Contains(data, []byte(`"oauth2"`)) {
				t.Fatal("key-only document contains OAuth2 fields")
			}
			if config.SubjectID != testSubjectID || hasOAuth2Configuration(config) || hasAgentKeyConfiguration(config) {
				t.Fatalf("unexpected credential config: subject=%s", config.SubjectID)
			}
			if err := filepath.WalkDir(dir, func(path string, d os.DirEntry, err error) error {
				if err != nil {
					return err
				}
				if !d.IsDir() {
					b, err := os.ReadFile(path)
					if err != nil {
						return err
					}
					if bytes.Contains(b, []byte(sessionKey)) || bytes.Contains(b, []byte("unused-secret")) {
						t.Errorf("API credential persisted to %s", path)
					}
				}
				return nil
			}); err != nil {
				t.Fatal(err)
			}
			// A file is bootstrap input only; later processes still need the key.
			t.Setenv(agentKeyEnv, sessionKey)
			client, err := newAuthenticatedClient(server.URL, configPath)
			if err != nil {
				t.Fatal(err)
			}
			if _, err := fetchAgentWhoami(context.Background(), client); err != nil {
				t.Fatal(err)
			}
			if err := runConfigInitFromEnvCmdWithRegistry(&progress, "", "session", false, envFile, false, registry, defaultMigrationDestination); err != nil {
				t.Fatalf("repeat initialization: %v", err)
			}
			if tc.name == "key only" && runtime.GOOS != "windows" {
				assertSessionGitHubExec(t, configPath)
			}
			config.SubjectID = altSubjectID
			if _, err := WriteConfigTo(config, configPath); err != nil {
				t.Fatal(err)
			}
			if err := runConfigInitFromEnvCmdWithRegistry(&progress, "", "session", false, envFile, false, registry, defaultMigrationDestination); err == nil || !strings.Contains(err.Error(), "existing identity") {
				t.Fatalf("expected existing identity mismatch, got %v", err)
			}
			// The same bootstrap assets support real SSH commit signing.
			repo := t.TempDir()
			for _, args := range [][]string{{"init", "-q"}, {"-c", "core.hooksPath=/dev/null", "commit", "--allow-empty", "-S", "-m", "test"}} {
				cmd := exec.Command("git", args...)
				cmd.Dir = repo
				cmd.Env = append(os.Environ(), "GIT_CONFIG_GLOBAL="+filepath.Join(dir, "gitconfig"), "GIT_CONFIG_NOSYSTEM=1")
				if out, err := cmd.CombinedOutput(); err != nil {
					t.Fatalf("git %v: %v: %s", args, err, out)
				}
			}
		})
	}
}

func TestConfigInitFromEnvRejectsAmbiguousSessionKey(t *testing.T) {
	clearMoltnetEnv(t)
	setTestHome(t, t.TempDir())
	t.Setenv(agentKeyEnv, "session-test-key")
	t.Setenv(agentKeyRefEnv, "os-keyring:"+AgentKeyKey(testSubjectID))
	err := runConfigInitFromEnvCmd(io.Discard, "", "session", true, "", false, defaultMigrationDestination)
	if err == nil || !strings.Contains(err.Error(), "set only one") {
		t.Fatalf("got %v", err)
	}
}

// Exercise GitHub token minting and the child command using the key-only
// document and App assets actually produced by init-from-env.
func assertSessionGitHubExec(t *testing.T, configPath string) {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.Method == http.MethodGet {
			_, _ = io.WriteString(w, `{"id":456}`)
			return
		}
		w.WriteHeader(http.StatusCreated)
		_ = json.NewEncoder(w).Encode(map[string]any{"token": "session-github-token", "expires_at": time.Now().Add(time.Hour).UTC().Format(time.RFC3339), "permissions": map[string]string{"contents": "read"}})
	}))
	t.Cleanup(server.Close)
	old := githubAPIBaseURL
	githubAPIBaseURL = server.URL
	t.Cleanup(func() { githubAPIBaseURL = old })
	bin := t.TempDir()
	if err := os.WriteFile(filepath.Join(bin, "gh"), []byte("#!/bin/sh\ntest \"$GH_TOKEN\" = session-github-token\n"), 0755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", bin+string(os.PathListSeparator)+os.Getenv("PATH"))
	var stdout, stderr bytes.Buffer
	if err := runGitHubExecCmd(configPath, []string{"gh", "repo", "view", "-R", "example/project"}, strings.NewReader(""), &stdout, &stderr); err != nil {
		t.Fatalf("github exec: %v: %s", err, stderr.String())
	}
}
