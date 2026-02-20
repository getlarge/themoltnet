package main

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// newTestAPISetup creates a token server and api server for testing.
// The token server always returns the given token.
func newTestAPISetup(t *testing.T, token string, handler http.HandlerFunc) (*httptest.Server, *httptest.Server, *APIClient) {
	t.Helper()
	tokenSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{ //nolint:errcheck
			"access_token": token,
			"token_type":   "Bearer",
			"expires_in":   3600,
		})
	}))
	apiSrv := httptest.NewServer(handler)
	tm := NewTokenManager(tokenSrv.URL, "client-id", "client-secret")
	client := NewAPIClient(apiSrv.URL, tm)
	return tokenSrv, apiSrv, client
}

func TestAPIClientGet(t *testing.T) {
	tokenSrv, apiSrv, client := newTestAPISetup(t, "tok-get", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet || r.URL.Path != "/agents/whoami" {
			t.Errorf("unexpected: %s %s", r.Method, r.URL.Path)
		}
		auth := r.Header.Get("Authorization")
		if auth != "Bearer tok-get" {
			t.Errorf("expected Bearer tok-get, got %q", auth)
		}
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"identity_id":"abc"}`)) //nolint:errcheck
	}))
	defer tokenSrv.Close()
	defer apiSrv.Close()

	body, err := client.Get("/agents/whoami")
	if err != nil {
		t.Fatalf("Get() error: %v", err)
	}
	if !strings.Contains(string(body), "abc") {
		t.Errorf("expected body to contain abc, got %q", string(body))
	}
}

func TestAPIClientPost(t *testing.T) {
	tokenSrv, apiSrv, client := newTestAPISetup(t, "tok-post", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/signing-requests" {
			t.Errorf("unexpected: %s %s", r.Method, r.URL.Path)
		}
		if ct := r.Header.Get("Content-Type"); ct != "application/json" {
			t.Errorf("expected Content-Type application/json, got %q", ct)
		}
		var payload map[string]string
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			t.Errorf("decode body: %v", err)
		}
		if payload["message"] != "hello" {
			t.Errorf("expected message=hello, got %q", payload["message"])
		}
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"id":"req-1"}`)) //nolint:errcheck
	}))
	defer tokenSrv.Close()
	defer apiSrv.Close()

	body, err := client.Post("/signing-requests", map[string]string{"message": "hello"})
	if err != nil {
		t.Fatalf("Post() error: %v", err)
	}
	if !strings.Contains(string(body), "req-1") {
		t.Errorf("expected body to contain req-1, got %q", string(body))
	}
}

func TestAPIClientDelete(t *testing.T) {
	tokenSrv, apiSrv, client := newTestAPISetup(t, "tok-del", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodDelete || r.URL.Path != "/diary/entry-1" {
			t.Errorf("unexpected: %s %s", r.Method, r.URL.Path)
		}
		w.WriteHeader(http.StatusNoContent)
	}))
	defer tokenSrv.Close()
	defer apiSrv.Close()

	if err := client.Delete("/diary/entry-1"); err != nil {
		t.Fatalf("Delete() error: %v", err)
	}
}

func TestAPIClientPatch(t *testing.T) {
	tokenSrv, apiSrv, client := newTestAPISetup(t, "tok-patch", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPatch || r.URL.Path != "/diary/entry-1" {
			t.Errorf("unexpected: %s %s", r.Method, r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"id":"entry-1","content":"updated"}`)) //nolint:errcheck
	}))
	defer tokenSrv.Close()
	defer apiSrv.Close()

	body, err := client.Patch("/diary/entry-1", map[string]string{"content": "updated"})
	if err != nil {
		t.Fatalf("Patch() error: %v", err)
	}
	if !strings.Contains(string(body), "updated") {
		t.Errorf("expected body to contain updated, got %q", string(body))
	}
}

func TestAPIClientNon2xx(t *testing.T) {
	tokenSrv, apiSrv, client := newTestAPISetup(t, "tok-err", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, `{"title":"Not Found"}`, http.StatusNotFound)
	}))
	defer tokenSrv.Close()
	defer apiSrv.Close()

	_, err := client.Get("/missing")
	if err == nil {
		t.Fatal("expected error for 404, got nil")
	}
	if !strings.Contains(err.Error(), "404") {
		t.Errorf("expected error to contain 404, got %q", err.Error())
	}
}

func TestAPIClientRetry401(t *testing.T) {
	callCount := 0
	tokenSrv, apiSrv, client := newTestAPISetup(t, "tok-retry", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		callCount++
		if callCount == 1 {
			// First call: simulate token expired
			w.WriteHeader(http.StatusUnauthorized)
			io.WriteString(w, `{"error":"token_expired"}`) //nolint:errcheck
			return
		}
		// Second call: success
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"ok":true}`)) //nolint:errcheck
	}))
	defer tokenSrv.Close()
	defer apiSrv.Close()

	body, err := client.Get("/agents/whoami")
	if err != nil {
		t.Fatalf("Get() error after retry: %v", err)
	}
	if !strings.Contains(string(body), "ok") {
		t.Errorf("expected body to contain ok, got %q", string(body))
	}
	if callCount != 2 {
		t.Errorf("expected 2 API calls (original + retry), got %d", callCount)
	}
}
