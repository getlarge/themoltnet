package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestAgentsWhoami(t *testing.T) {
	// Arrange
	want := map[string]string{
		"identityId":  "id-123",
		"publicKey":   "pk-abc",
		"fingerprint": "fp-xyz",
		"clientId":    "ci-000",
	}
	tokenSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{"access_token": "tok", "expires_in": 3600}) //nolint:errcheck
	}))
	defer tokenSrv.Close()
	apiSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet || r.URL.Path != "/agents/whoami" {
			t.Errorf("unexpected: %s %s", r.Method, r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(want) //nolint:errcheck
	}))
	defer apiSrv.Close()
	tm := NewTokenManager(tokenSrv.URL, "cid", "csec")
	client := NewAPIClient(apiSrv.URL, tm)

	// Act
	result, err := agentsWhoami(client)

	// Assert
	if err != nil {
		t.Fatalf("agentsWhoami() error: %v", err)
	}
	if result["identityId"] != "id-123" {
		t.Errorf("expected identityId=id-123, got %q", result["identityId"])
	}
}

func TestAgentsLookup(t *testing.T) {
	// Arrange
	tokenSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{"access_token": "tok", "expires_in": 3600}) //nolint:errcheck
	}))
	defer tokenSrv.Close()
	apiSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet || r.URL.Path != "/agents/fp-abc" {
			t.Errorf("unexpected: %s %s", r.Method, r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{"fingerprint": "fp-abc"}) //nolint:errcheck
	}))
	defer apiSrv.Close()
	tm := NewTokenManager(tokenSrv.URL, "cid", "csec")
	client := NewAPIClient(apiSrv.URL, tm)

	// Act
	result, err := agentsLookup(client, "fp-abc")

	// Assert
	if err != nil {
		t.Fatalf("agentsLookup() error: %v", err)
	}
	if result["fingerprint"] != "fp-abc" {
		t.Errorf("expected fingerprint=fp-abc, got %q", result["fingerprint"])
	}
}
