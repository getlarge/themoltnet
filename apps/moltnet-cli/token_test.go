package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func newTestTokenServer(t *testing.T, token string, expiresIn int) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/oauth2/token" {
			t.Errorf("unexpected request: %s %s", r.Method, r.URL.Path)
			http.Error(w, "unexpected", http.StatusBadRequest)
			return
		}
		if err := r.ParseForm(); err != nil {
			t.Errorf("ParseForm error: %v", err)
			http.Error(w, "bad request", http.StatusBadRequest)
			return
		}
		if r.FormValue("grant_type") != "client_credentials" {
			t.Errorf("expected client_credentials grant, got %q", r.FormValue("grant_type"))
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{
			"access_token": token,
			"token_type":   "Bearer",
			"expires_in":   expiresIn,
		})
	}))
}

func TestTokenManagerGetToken(t *testing.T) {
	srv := newTestTokenServer(t, "tok-abc", 3600)
	defer srv.Close()

	tm := NewTokenManager(srv.URL, "client-id", "client-secret")
	token, err := tm.GetToken()
	if err != nil {
		t.Fatalf("GetToken() error: %v", err)
	}
	if token != "tok-abc" {
		t.Errorf("expected tok-abc, got %q", token)
	}
}

func TestTokenManagerCachesToken(t *testing.T) {
	callCount := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		callCount++
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{
			"access_token": "tok-cached",
			"token_type":   "Bearer",
			"expires_in":   3600,
		})
	}))
	defer srv.Close()

	tm := NewTokenManager(srv.URL, "client-id", "client-secret")

	for i := 0; i < 3; i++ {
		_, err := tm.GetToken()
		if err != nil {
			t.Fatalf("GetToken() call %d error: %v", i, err)
		}
	}

	if callCount != 1 {
		t.Errorf("expected 1 HTTP call, got %d", callCount)
	}
}

func TestTokenManagerRefreshesExpired(t *testing.T) {
	callCount := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		callCount++
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{
			"access_token": "tok-refreshed",
			"token_type":   "Bearer",
			"expires_in":   3600,
		})
	}))
	defer srv.Close()

	tm := NewTokenManager(srv.URL, "client-id", "client-secret")
	// Force the token to appear already expired by backdating expiresAt
	tm.cached = "tok-old"
	tm.expiresAt = time.Now().Add(-1 * time.Second)

	token, err := tm.GetToken()
	if err != nil {
		t.Fatalf("GetToken() error: %v", err)
	}
	if token != "tok-refreshed" {
		t.Errorf("expected tok-refreshed, got %q", token)
	}
	if callCount != 1 {
		t.Errorf("expected 1 HTTP call after expiry, got %d", callCount)
	}
}

func TestTokenManagerInvalidate(t *testing.T) {
	callCount := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		callCount++
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{
			"access_token": "tok-new",
			"token_type":   "Bearer",
			"expires_in":   3600,
		})
	}))
	defer srv.Close()

	tm := NewTokenManager(srv.URL, "client-id", "client-secret")

	// Fetch once to populate cache
	_, err := tm.GetToken()
	if err != nil {
		t.Fatalf("first GetToken() error: %v", err)
	}

	// Invalidate simulates a 401 response
	tm.Invalidate()

	// Next call must fetch fresh token
	token, err := tm.GetToken()
	if err != nil {
		t.Fatalf("second GetToken() error: %v", err)
	}
	if token != "tok-new" {
		t.Errorf("expected tok-new, got %q", token)
	}
	if callCount != 2 {
		t.Errorf("expected 2 HTTP calls after invalidate, got %d", callCount)
	}
}

func TestTokenManagerAuthError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, `{"error":"invalid_client"}`, http.StatusUnauthorized)
	}))
	defer srv.Close()

	tm := NewTokenManager(srv.URL, "bad-id", "bad-secret")
	_, err := tm.GetToken()
	if err == nil {
		t.Fatal("expected error for 401 response, got nil")
	}
}

func TestTokenManagerSurfacesOAuthError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(`{"error":"invalid_scope","error_description":"The OAuth 2.0 Client is not allowed to request scope 'task:write'."}`))
	}))
	defer srv.Close()

	tm := NewTokenManager(srv.URL, "id", "secret")
	_, err := tm.GetToken()
	if err == nil {
		t.Fatal("expected error for 400 response, got nil")
	}
	for _, want := range []string{"HTTP 400", "invalid_scope", "task:write", "client scopes need updating"} {
		if !strings.Contains(err.Error(), want) {
			t.Errorf("error %q does not mention %q", err.Error(), want)
		}
	}
}
