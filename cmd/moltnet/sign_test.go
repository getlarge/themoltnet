package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func TestRunSignWithCredentialsFile(t *testing.T) {
	// Generate a keypair for testing
	kp, err := GenerateKeyPair()
	if err != nil {
		t.Fatalf("generate keypair: %v", err)
	}

	// Write a temporary credentials file
	dir := t.TempDir()
	credPath := filepath.Join(dir, "credentials.json")
	creds := CredentialsFile{
		IdentityID: "test-identity",
		Keys: CredentialsKeys{
			PublicKey:   kp.PublicKey,
			PrivateKey:  kp.PrivateKey,
			Fingerprint: kp.Fingerprint,
		},
	}
	data, err := json.Marshal(creds)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	if err := os.WriteFile(credPath, data, 0o600); err != nil {
		t.Fatalf("write: %v", err)
	}

	// Load credentials from the temp file
	loaded, err := ReadConfigFrom(credPath)
	if err != nil {
		t.Fatalf("read credentials: %v", err)
	}
	if loaded == nil {
		t.Fatal("credentials nil")
	}

	// Sign and verify
	message := "test message"
	nonce := "nonce-123"
	sig, err := SignForRequest(message, nonce, loaded.Keys.PrivateKey)
	if err != nil {
		t.Fatalf("sign: %v", err)
	}

	valid, err := VerifyForRequest(message, nonce, sig, loaded.Keys.PublicKey)
	if err != nil {
		t.Fatalf("verify: %v", err)
	}
	if !valid {
		t.Error("signature verification failed")
	}
}

func TestReadPayloadFromArgs(t *testing.T) {
	payload, err := readPayload([]string{"hello message"})
	if err != nil {
		t.Fatalf("readPayload: %v", err)
	}
	if payload != "hello message" {
		t.Errorf("got %q, want %q", payload, "hello message")
	}
}

func TestReadPayloadNoArgs(t *testing.T) {
	_, err := readPayload([]string{})
	if err == nil {
		t.Error("expected error for empty args")
	}
}

func TestLoadCredentialsMissing(t *testing.T) {
	_, err := loadCredentials(filepath.Join(t.TempDir(), "nonexistent.json"))
	if err == nil {
		t.Error("expected error for missing credentials")
	}
}

func TestSignWithRequestID(t *testing.T) {
	// Arrange: generate a real keypair
	kp, err := GenerateKeyPair()
	if err != nil {
		t.Fatalf("generate keypair: %v", err)
	}

	message := "hello from test"
	nonce := "nonce-abc-123"
	requestID := "req-uuid-1"

	// Track which endpoints were hit
	getHit := false
	submitHit := false

	tokenSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{"access_token": "tok", "expires_in": 3600}) //nolint:errcheck
	}))
	defer tokenSrv.Close()

	apiSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodGet && r.URL.Path == "/crypto/signing-requests/"+requestID:
			getHit = true
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(map[string]string{ //nolint:errcheck
				"id":      requestID,
				"message": message,
				"nonce":   nonce,
				"status":  "pending",
			})
		case r.Method == http.MethodPost && r.URL.Path == "/crypto/signing-requests/"+requestID+"/sign":
			submitHit = true
			var body map[string]string
			json.NewDecoder(r.Body).Decode(&body) //nolint:errcheck
			if body["signature"] == "" {
				t.Error("expected non-empty signature in submit body")
			}
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(map[string]string{"id": requestID, "status": "completed"}) //nolint:errcheck
		default:
			t.Errorf("unexpected: %s %s", r.Method, r.URL.Path)
			http.Error(w, "unexpected", http.StatusNotFound)
		}
	}))
	defer apiSrv.Close()

	tm := NewTokenManager(tokenSrv.URL, "cid", "csec")
	client := NewAPIClient(apiSrv.URL, tm)

	// Act
	if err := signWithRequestID(client, requestID, kp.PrivateKey); err != nil {
		t.Fatalf("signWithRequestID() error: %v", err)
	}

	// Assert
	if !getHit {
		t.Error("expected GET signing request to be called")
	}
	if !submitHit {
		t.Error("expected POST sign to be called")
	}
}
