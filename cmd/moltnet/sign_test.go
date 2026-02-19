package main

import (
	"encoding/json"
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
	loaded, err := ReadCredentialsFrom(credPath)
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
