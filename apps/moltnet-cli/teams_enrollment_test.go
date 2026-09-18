package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os"

	moltnetapi "github.com/getlarge/themoltnet/libs/moltnet-api-client"
	"strings"
	"testing"
)

func TestTeamEnrollmentRequiresExplicitIssuanceAndRetryKey(t *testing.T) {
	for _, opts := range []teamsJoinOpts{
		{store: agentKeyStoreOpts{enabled: true}},
		{issueAgentKey: true},
		{issueAgentKey: true, idempotencyKey: "   "},
	} {
		var out bytes.Buffer
		opts.out = &out
		opts.errOut = &out
		err := runTeamsJoinWithOptions(opts)
		if err == nil || !strings.Contains(err.Error(), "requires") {
			t.Fatalf("expected validation before credential lookup: %v", err)
		}
		if out.Len() != 0 {
			t.Fatal("invalid enrollment emitted output")
		}
	}
}

func TestEnrollmentLostResponseRetainsRetryContextThroughConflict(t *testing.T) {
	const code, idem = "private-invite-code", "stable-enrollment-request"
	t.Setenv(agentKeyEnv, "incoming-key")
	t.Setenv(agentKeyRefEnv, "")
	path := writeAgentKeyStoreFixture(t, testAgentID)
	before, _ := os.ReadFile(path)
	registry, provider := newMemorySecretProviderRegistry()
	capture := newRecoveryCapture(t)
	issued, calls := false, 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if r.URL.Path != "/teams/join" || r.Header.Get("Idempotency-Key") != idem {
			t.Error("retry context changed")
		}
		var req moltnetapi.JoinTeamReq
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			t.Error(err)
		}
		if req.Code != code {
			t.Error("invitation changed")
		}
		if !issued {
			issued = true
			conn, _, err := w.(http.Hijacker).Hijack()
			if err != nil {
				t.Error(err)
				return
			}
			_ = conn.Close()
			return
		}
		w.Header().Set("Content-Type", "application/problem+json")
		w.WriteHeader(http.StatusConflict)
		_ = json.NewEncoder(w).Encode(map[string]any{"type": "about:blank", "title": "Conflict", "status": 409, "code": "CONFLICT", "conflict": map[string]any{"target": map[string]any{"resource": "agent-key", "keys": map[string]string{"keyId": "issued-key-1", "subjectId": testAgentID, "teamId": testTeamID}}}})
	}))
	defer server.Close()
	for i := 0; i < 2; i++ {
		var out, errOut bytes.Buffer
		err := runTeamsJoinWithOptions(teamsJoinOpts{apiURL: server.URL, credPath: path, code: code, idempotencyKey: idem, issueAgentKey: true, store: storeOpts(registry, capture), out: &out, errOut: &errOut})
		want := "outcome is unknown"
		if i == 1 {
			want = "already issued key issued-key-1"
		}
		if err == nil || !strings.Contains(err.Error(), want) {
			t.Fatalf("unexpected result: %v", err)
		}
		if strings.Contains(err.Error(), code) || strings.Contains(out.String()+errOut.String(), code) {
			t.Fatal("invitation escaped protected storage")
		}
		artifact := capture.latest(t)
		if i == 0 && (artifact.Stage != "issuance_outcome_unknown" || artifact.Enrollment == nil || artifact.Enrollment.Code != code || artifact.Enrollment.IdempotencyKey != idem || artifact.Enrollment.SubjectID != testAgentID || artifact.Enrollment.APIURL != server.URL) {
			t.Fatalf("missing reconciliation context: %+v", artifact)
		}
		if i == 1 && (artifact.Stage != "issued_secret_unavailable" || artifact.Reconciliation == nil || artifact.Reconciliation.KeyID != "issued-key-1" || artifact.Reconciliation.SubjectID != testAgentID || artifact.Reconciliation.TeamID != testTeamID) {
			t.Fatal("completed replay did not identify the exact credential")
		}
		info, err := os.Stat(capture.paths[i])
		if err != nil || info.Mode().Perm() != 0600 {
			t.Fatal("missing protected pending artifact")
		}
	}
	if calls != 2 || !issued || len(provider.values) != 0 {
		t.Fatal("retry issued or stored another credential")
	}
	for _, p := range capture.paths {
		if _, err := os.Stat(p); err != nil {
			t.Fatal("retry deleted earlier unknown state")
		}
	}
	after, _ := os.ReadFile(path)
	if !bytes.Equal(before, after) {
		t.Fatal("unknown issuance changed credentials")
	}
}

func TestEnrollmentDefinitiveRejectionRemovesPendingArtifact(t *testing.T) {
	t.Setenv(agentKeyEnv, "incoming-key")
	t.Setenv(agentKeyRefEnv, "")
	path := writeAgentKeyStoreFixture(t, testAgentID)
	registry, _ := newMemorySecretProviderRegistry()
	capture := newRecoveryCapture(t)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/problem+json")
		w.WriteHeader(404)
		_, _ = io.WriteString(w, `{"type":"about:blank","title":"Not Found","status":404,"code":"NOT_FOUND","detail":"Invalid invite"}`)
	}))
	defer server.Close()
	var out bytes.Buffer
	err := runTeamsJoinWithOptions(teamsJoinOpts{apiURL: server.URL, credPath: path, code: "invalid", idempotencyKey: "request", issueAgentKey: true, store: storeOpts(registry, capture), out: &out, errOut: &out})
	if err == nil {
		t.Fatal("expected rejection")
	}
	if len(capture.paths) != 1 {
		t.Fatal("pending not reserved")
	}
	if _, err := os.Stat(capture.paths[0]); !os.IsNotExist(err) {
		t.Fatal("definitive rejection retained pending state")
	}
}

func TestEnrollmentRejectionReportsPendingCleanupFailure(t *testing.T) {
	t.Setenv(agentKeyEnv, "incoming-key")
	t.Setenv(agentKeyRefEnv, "")
	path := writeAgentKeyStoreFixture(t, testAgentID)
	registry, _ := newMemorySecretProviderRegistry()
	capture := newRecoveryCapture(t)
	opts := storeOpts(registry, capture)
	opts.removeRecovery = func(string) error { return errors.New("remove denied") }
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/problem+json")
		w.WriteHeader(404)
		_, _ = io.WriteString(w, `{"type":"about:blank","title":"Not Found","status":404,"code":"NOT_FOUND"}`)
	}))
	defer server.Close()
	var out bytes.Buffer
	err := runTeamsJoinWithOptions(teamsJoinOpts{apiURL: server.URL, credPath: path, code: "private-code", idempotencyKey: "request", issueAgentKey: true, store: opts, out: &out, errOut: &out})
	if err == nil || !strings.Contains(err.Error(), "cleanup failed") || !strings.Contains(err.Error(), capture.paths[0]) {
		t.Fatalf("cleanup failure hidden: %v", err)
	}
	if _, err := os.Stat(capture.paths[0]); err != nil {
		t.Fatal("expected stale protected artifact")
	}
	if strings.Contains(err.Error(), "private-code") {
		t.Fatal("invite leaked")
	}
}
