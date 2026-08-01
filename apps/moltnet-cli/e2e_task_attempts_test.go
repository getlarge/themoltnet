//go:build e2e

package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// TestE2E_CLI_TaskAttempts_AcceptsAdditiveResponseFields runs the compiled CLI
// against an HTTP server that emulates a newer API. The extra field proves the
// complete command boundary stays forward-compatible, including OAuth, ogen
// response decoding, command projection, and stdout encoding.
func TestE2E_CLI_TaskAttempts_AcceptsAdditiveResponseFields(t *testing.T) {
	taskID := "11111111-1111-4111-8111-111111111111"
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.URL.Path == "/oauth2/token":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"access_token":"e2e-token","expires_in":3600}`))
		case r.URL.Path == "/tasks/"+taskID+"/attempts":
			if got := r.Header.Get("Authorization"); got != "Bearer e2e-token" {
				http.Error(w, "missing bearer token", http.StatusUnauthorized)
				return
			}
			w.Header().Set("Content-Type", "application/json")
			_, _ = fmt.Fprintf(w, `[{"taskId":%q,"attemptN":1,"claimedByAgentId":"22222222-2222-4222-8222-222222222222","leaseId":null,"runtimeProfileId":null,"runtimeProfileRevision":null,"policySnapshotHash":null,"runtimeId":null,"claimedAt":"2026-06-04T12:00:00Z","startedAt":null,"completedAt":null,"status":"claimed","output":null,"outputCid":null,"claimedExecutorFingerprint":null,"claimedExecutorManifest":null,"completedExecutorFingerprint":null,"completedExecutorManifest":null,"error":null,"usage":null,"contentSignature":null,"signedAt":null,"daemonState":null,"futureServerField":{"revision":2}}]`, taskID)
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	credsPath, err := writeE2ECredsFile(&CredentialsFile{
		IdentityID: "22222222-2222-4222-8222-222222222222",
		OAuth2: CredentialsOAuth2{
			ClientID:     "e2e-client",
			ClientSecret: "e2e-secret",
		},
		Endpoints: CredentialsEndpoints{API: server.URL},
	})
	if err != nil {
		t.Fatalf("write credentials: %v", err)
	}
	binPath, err := ensureE2ECLIBinary()
	if err != nil {
		t.Fatalf("build CLI: %v", err)
	}

	stdout, stderr, err := runE2eCLIWithAuthAtURL(
		binPath,
		credsPath,
		"",
		server.URL,
		"task", "attempts", taskID,
	)
	if err != nil {
		t.Fatalf("task attempts failed: %v\nstderr: %s", err, stderr)
	}

	var attempts []map[string]any
	if err := json.Unmarshal([]byte(stdout), &attempts); err != nil {
		t.Fatalf("decode stdout: %v\nstdout: %s", err, stdout)
	}
	if len(attempts) != 1 || attempts[0]["attemptN"] != float64(1) {
		t.Fatalf("unexpected attempts output: %v", attempts)
	}
	if !strings.Contains(stdout, `"futureServerField"`) {
		t.Errorf("additive response field was not preserved: %s", stdout)
	}
}
