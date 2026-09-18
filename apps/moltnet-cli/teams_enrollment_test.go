package main

import (
	"bytes"
	"encoding/json"
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
		_, _ = io.WriteString(w, `{"type":"about:blank","title":"Conflict","status":409,"detail":"Already issued"}`)
	}))
	defer server.Close()
	for i := 0; i < 2; i++ {
		var out, errOut bytes.Buffer
		err := runTeamsJoinWithOptions(teamsJoinOpts{apiURL: server.URL, credPath: path, code: code, idempotencyKey: idem, issueAgentKey: true, store: storeOpts(registry, capture), out: &out, errOut: &errOut})
		if err == nil || !strings.Contains(err.Error(), "outcome is unknown") {
			t.Fatalf("unexpected result: %v", err)
		}
		if strings.Contains(err.Error(), code) || strings.Contains(out.String()+errOut.String(), code) {
			t.Fatal("invitation escaped protected storage")
		}
		artifact := capture.latest(t)
		if artifact.Stage != "issuance_outcome_unknown" || artifact.Enrollment == nil || artifact.Enrollment.Code != code || artifact.Enrollment.IdempotencyKey != idem || artifact.Enrollment.SubjectID != testAgentID || artifact.Enrollment.APIURL != server.URL {
			t.Fatalf("missing reconciliation context: %+v", artifact)
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
		_, _ = io.WriteString(w, `{"type":"about:blank","title":"Not Found","status":404,"detail":"Invalid invite"}`)
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
