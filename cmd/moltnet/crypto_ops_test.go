package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func newTestClientPair(t *testing.T, handler http.HandlerFunc) (*httptest.Server, *httptest.Server, *APIClient) {
	t.Helper()
	tokenSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{"access_token": "tok", "expires_in": 3600}) //nolint:errcheck
	}))
	apiSrv := httptest.NewServer(handler)
	tm := NewTokenManager(tokenSrv.URL, "cid", "csec")
	client := NewAPIClient(apiSrv.URL, tm)
	return tokenSrv, apiSrv, client
}

func TestCryptoIdentity(t *testing.T) {
	// Arrange
	tokenSrv, apiSrv, client := newTestClientPair(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet || r.URL.Path != "/crypto/identity" {
			t.Errorf("unexpected: %s %s", r.Method, r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{"publicKey": "pk-abc", "fingerprint": "fp-xyz"}) //nolint:errcheck
	}))
	defer tokenSrv.Close()
	defer apiSrv.Close()

	// Act
	result, err := cryptoIdentity(client)

	// Assert
	if err != nil {
		t.Fatalf("cryptoIdentity() error: %v", err)
	}
	if result["fingerprint"] != "fp-xyz" {
		t.Errorf("expected fingerprint=fp-xyz, got %v", result["fingerprint"])
	}
}

func TestCryptoVerify(t *testing.T) {
	// Arrange
	tokenSrv, apiSrv, client := newTestClientPair(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/crypto/verify" {
			t.Errorf("unexpected: %s %s", r.Method, r.URL.Path)
		}
		var body map[string]string
		json.NewDecoder(r.Body).Decode(&body) //nolint:errcheck
		if body["signature"] != "sig-abc" {
			t.Errorf("expected signature=sig-abc, got %q", body["signature"])
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{"valid": true}) //nolint:errcheck
	}))
	defer tokenSrv.Close()
	defer apiSrv.Close()

	// Act
	result, err := cryptoVerify(client, "sig-abc")

	// Assert
	if err != nil {
		t.Fatalf("cryptoVerify() error: %v", err)
	}
	if result["valid"] != true {
		t.Errorf("expected valid=true, got %v", result["valid"])
	}
}
