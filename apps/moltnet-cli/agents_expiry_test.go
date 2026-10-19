package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	moltnetapi "github.com/getlarge/themoltnet/libs/moltnet-api-client"
)

func TestAgentKeyExpiryWarning(t *testing.T) {
	now := time.Date(2026, 10, 19, 12, 0, 0, 0, time.UTC)
	for _, tc := range []struct {
		name               string
		daysUntil          int
		team, absent, null bool
		want               bool
	}{
		{name: "near identity expiry", daysUntil: 3, want: true},
		{name: "near team expiry", daysUntil: 3, team: true, want: true},
		{name: "boundary", daysUntil: 7, want: true},
		{name: "later", daysUntil: 8},
		{name: "already expired", daysUntil: -1, want: true},
		{name: "no binding", absent: true},
		{name: "no expiry", null: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			whoami := &moltnetapi.Whoami{}
			expiry := moltnetapi.NewOptNilDateTime(now.Add(time.Duration(tc.daysUntil) * 24 * time.Hour))
			if tc.null {
				expiry.SetToNull()
			}
			if !tc.absent {
				binding := moltnetapi.NewProvenanceGraphIdentityNodeWhoamiCredentialBinding(moltnetapi.ProvenanceGraphIdentityNode{ExpiresAt: expiry})
				if tc.team {
					binding = moltnetapi.NewProvenanceGraphTeamNodeWhoamiCredentialBinding(moltnetapi.ProvenanceGraphTeamNode{ExpiresAt: expiry})
				}
				whoami.CredentialBinding = moltnetapi.NewOptWhoamiCredentialBinding(binding)
			}
			var out bytes.Buffer
			warnAgentKeyExpiry(&out, whoami, 7, now)
			if strings.Contains(out.String(), "replace the session key") != tc.want {
				t.Fatalf("unexpected warning: %q", out.String())
			}
		})
	}
}

func TestWhoamiExpiryFlag(t *testing.T) {
	clearMoltnetEnv(t)
	setTestHome(t, t.TempDir())
	t.Setenv(agentKeyEnv, "session-test-key")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer session-test-key" {
			t.Error("wrong credential")
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"subjectId": testSubjectID, "subjectType": "agent", "identityId": testSubjectID,
			"scopes":            []string{"agent:profile"},
			"credentialBinding": map[string]any{"bindingScope": "identity", "keyId": altSubjectID, "expiresAt": time.Now().Add(24 * time.Hour).UTC().Format(time.RFC3339)},
		})
	}))
	defer server.Close()
	t.Setenv("MOLTNET_API_URL", server.URL)
	stdout, stderr, err := executeCommand(NewRootCmd("test", ""), "agents", "whoami", "--warn-expiry-days", "7")
	if err != nil {
		t.Fatal(err)
	}
	if !json.Valid([]byte(stdout)) || !strings.Contains(stderr, "replace the session key") {
		t.Fatalf("stdout=%s stderr=%s", stdout, stderr)
	}
	_, stderr, err = executeCommand(NewRootCmd("test", ""), "agents", "whoami")
	if err != nil || strings.Contains(stderr, "expires at") {
		t.Fatalf("default whoami changed: %s %v", stderr, err)
	}
	_, _, err = executeCommand(NewRootCmd("test", ""), "agents", "whoami", "--warn-expiry-days", "-1")
	if err == nil || !strings.Contains(err.Error(), "nonnegative") {
		t.Fatalf("negative threshold accepted: %v", err)
	}
}
