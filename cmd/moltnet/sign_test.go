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
	payload := "test.nonce123"
	sig, err := Sign(payload, loaded.Keys.PrivateKey)
	if err != nil {
		t.Fatalf("sign: %v", err)
	}

	valid, err := Verify(payload, sig, loaded.Keys.PublicKey)
	if err != nil {
		t.Fatalf("verify: %v", err)
	}
	if !valid {
		t.Error("signature verification failed")
	}
}

func TestReadPayloadFromArgs(t *testing.T) {
	payload, err := readPayload([]string{"hello.nonce"})
	if err != nil {
		t.Fatalf("readPayload: %v", err)
	}
	if payload != "hello.nonce" {
		t.Errorf("got %q, want %q", payload, "hello.nonce")
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
