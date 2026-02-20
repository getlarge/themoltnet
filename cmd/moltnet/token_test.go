package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
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
		r.ParseForm()
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
