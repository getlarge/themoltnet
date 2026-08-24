package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestRunCapabilityCallPostsJSONAndPrintsResponse(t *testing.T) {
	var got struct {
		Path string
		Body map[string]any
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got.Path = r.URL.Path
		_ = json.NewDecoder(r.Body).Decode(&got.Body)
		_ = json.NewEncoder(w).Encode(map[string]string{"ok": "yes"})
	}))
	defer srv.Close()

	var out bytes.Buffer
	err := runCapabilityCallCmd(&out, srv.URL, "echo", "say", `{"text":"hi"}`)
	if err != nil {
		t.Fatalf("runCapabilityCallCmd: %v", err)
	}
	if got.Path != "/say" || got.Body["text"] != "hi" {
		t.Fatalf("unexpected request %+v", got)
	}
	if !strings.Contains(out.String(), `"ok": "yes"`) {
		t.Fatalf("unexpected output %q", out.String())
	}
}

func TestRunCapabilityCallSurfacesBrokerErrorCode(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusForbidden)
		_ = json.NewEncoder(w).Encode(map[string]string{"code": "host_capability_denied", "message": "secret-hint"})
	}))
	defer srv.Close()

	var out bytes.Buffer
	err := runCapabilityCallCmd(&out, srv.URL, "echo", "say", `{}`)
	if err == nil || !strings.Contains(err.Error(), "host_capability_denied") || strings.Contains(err.Error(), "secret-hint") {
		t.Fatalf("unexpected error %v", err)
	}
}

func TestCapabilityOriginDerivation(t *testing.T) {
	if got := capabilityOrigin("agent-signing"); got != "https://agent-signing.moltnet.internal" {
		t.Fatalf("capabilityOrigin = %q", got)
	}
}

func TestRunCapabilityCallRejectsNonLoopbackURLOverride(t *testing.T) {
	var out bytes.Buffer
	err := runCapabilityCallCmd(&out, "https://evil.example.com", "agent-signing", "sign-git-commit", `{}`)
	if err == nil || !strings.Contains(err.Error(), "loopback") {
		t.Fatalf("expected loopback restriction, got %v", err)
	}
	if out.Len() != 0 {
		t.Fatalf("no request should have been sent; got %q", out.String())
	}
}
