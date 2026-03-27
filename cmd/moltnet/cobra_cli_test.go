package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

func TestInfoHelp(t *testing.T) {
	root := NewRootCmd()
	stdout, _, err := executeCommand(root, "info", "--help")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !strings.Contains(stdout, "Display information") {
		t.Errorf("expected help to contain 'Display information', got: %s", stdout)
	}
	if !strings.Contains(stdout, "--json") {
		t.Errorf("expected help to contain '--json', got: %s", stdout)
	}
}

func TestInfoMissingServer(t *testing.T) {
	root := NewRootCmd()
	_, _, err := executeCommand(root, "info", "--api-url", "http://127.0.0.1:1")
	if err == nil {
		t.Fatal("expected error for unreachable server, got nil")
	}
	if !strings.Contains(err.Error(), "connect") && !strings.Contains(err.Error(), "refused") &&
		!strings.Contains(err.Error(), "dial") {
		t.Errorf("expected connection error, got: %v", err)
	}
}

func TestRegisterRequiresVoucher(t *testing.T) {
	root := NewRootCmd()
	_, _, err := executeCommand(root, "register")
	if err == nil {
		t.Fatal("expected error when voucher is missing, got nil")
	}
	if !strings.Contains(err.Error(), "voucher") {
		t.Errorf("expected error to mention 'voucher', got: %v", err)
	}
}

func TestRegisterHelp(t *testing.T) {
	root := NewRootCmd()
	stdout, _, err := executeCommand(root, "register", "--help")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !strings.Contains(stdout, "--voucher") {
		t.Errorf("expected help to contain '--voucher', got: %s", stdout)
	}
	if !strings.Contains(stdout, "Example") {
		t.Errorf("expected help to contain 'Example', got: %s", stdout)
	}
}

func TestSSHKeyHelp(t *testing.T) {
	root := NewRootCmd()
	stdout, _, err := executeCommand(root, "ssh-key", "--help")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !strings.Contains(stdout, "--output-dir") {
		t.Errorf("expected help to contain '--output-dir', got: %s", stdout)
	}
}

// --- sign command tests ---

func TestSignRequiresNonceOrRequestID(t *testing.T) {
	root := NewRootCmd()
	// Provide a dummy credentials file so we get past credential loading
	kp, err := GenerateKeyPair()
	if err != nil {
		t.Fatalf("generate keypair: %v", err)
	}
	dir := t.TempDir()
	credPath := filepath.Join(dir, "creds.json")
	creds := CredentialsFile{
		IdentityID: "test",
		Keys: CredentialsKeys{
			PublicKey:  kp.PublicKey,
			PrivateKey: kp.PrivateKey,
		},
	}
	data, _ := json.Marshal(creds)
	os.WriteFile(credPath, data, 0o600)

	_, _, err = executeCommand(root, "sign", "--credentials", credPath, "msg")
	if err == nil {
		t.Fatal("expected error when neither --nonce nor --request-id is provided")
	}
	if !strings.Contains(err.Error(), "nonce") && !strings.Contains(err.Error(), "request-id") {
		t.Errorf("expected error to mention nonce or request-id, got: %v", err)
	}
}

func TestSignHelp(t *testing.T) {
	root := NewRootCmd()
	stdout, _, err := executeCommand(root, "sign", "--help")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !strings.Contains(stdout, "--request-id") {
		t.Errorf("expected help to contain '--request-id', got: %s", stdout)
	}
	if !strings.Contains(stdout, "--nonce") {
		t.Errorf("expected help to contain '--nonce', got: %s", stdout)
	}
	// Check both modes appear in examples
	if !strings.Contains(stdout, "request-id") || !strings.Contains(stdout, "nonce") {
		t.Errorf("expected examples to show both modes, got: %s", stdout)
	}
}

// --- encrypt command tests ---

func TestEncryptRequiresRecipient(t *testing.T) {
	root := NewRootCmd()
	_, _, err := executeCommand(root, "encrypt", "msg")
	if err == nil {
		t.Fatal("expected error when --recipient is missing")
	}
	if !regexp.MustCompile(`required flag.*recipient`).MatchString(err.Error()) &&
		!strings.Contains(err.Error(), "recipient") {
		t.Errorf("expected error to mention 'recipient', got: %v", err)
	}
}

func TestEncryptHelp(t *testing.T) {
	root := NewRootCmd()
	stdout, _, err := executeCommand(root, "encrypt", "--help")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !strings.Contains(stdout, "--recipient") {
		t.Errorf("expected help to contain '--recipient', got: %s", stdout)
	}
	if !strings.Contains(stdout, "ed25519:") {
		t.Errorf("expected help to contain example with 'ed25519:', got: %s", stdout)
	}
}

// --- decrypt command tests ---

func TestDecryptHelp(t *testing.T) {
	root := NewRootCmd()
	stdout, _, err := executeCommand(root, "decrypt", "--help")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !strings.Contains(stdout, "sealed") || !strings.Contains(stdout, "envelope") {
		t.Errorf("expected help to mention sealed envelope, got: %s", stdout)
	}
	if !strings.Contains(stdout, "decrypt") {
		t.Errorf("expected help to contain 'decrypt', got: %s", stdout)
	}
}

// --- encrypt/decrypt round-trip CLI test ---

func TestEncryptDecryptRoundTripCLI(t *testing.T) {
	// Generate a test keypair
	kp, err := GenerateKeyPair()
	if err != nil {
		t.Fatalf("generate keypair: %v", err)
	}

	// Write a temp credentials file for decrypt
	dir := t.TempDir()
	credPath := filepath.Join(dir, "creds.json")
	creds := CredentialsFile{
		IdentityID: "test-agent",
		Keys: CredentialsKeys{
			PublicKey:   kp.PublicKey,
			PrivateKey:  kp.PrivateKey,
			Fingerprint: kp.Fingerprint,
		},
	}
	data, err := json.Marshal(creds)
	if err != nil {
		t.Fatalf("marshal creds: %v", err)
	}
	if err := os.WriteFile(credPath, data, 0o600); err != nil {
		t.Fatalf("write creds: %v", err)
	}

	plaintext := "hello from CLI round-trip test"

	// Encrypt
	encRoot := NewRootCmd()
	encOut, _, err := executeCommand(encRoot, "encrypt", "--recipient", kp.PublicKey, plaintext)
	if err != nil {
		t.Fatalf("encrypt command error: %v", err)
	}

	sealedJSON := strings.TrimSpace(encOut)
	if sealedJSON == "" {
		t.Fatal("encrypt produced empty output")
	}

	// Verify it's valid JSON
	var envelope SealedEnvelope
	if err := json.Unmarshal([]byte(sealedJSON), &envelope); err != nil {
		t.Fatalf("encrypt output is not valid JSON: %v\noutput: %s", err, sealedJSON)
	}

	// Decrypt
	decRoot := NewRootCmd()
	decOut, _, err := executeCommand(decRoot, "decrypt", "--credentials", credPath, sealedJSON)
	if err != nil {
		t.Fatalf("decrypt command error: %v", err)
	}

	if decOut != plaintext {
		t.Errorf("round-trip mismatch\n  got:  %q\n  want: %q", decOut, plaintext)
	}
}

// --- git command tests ---

func TestGitNoSubcommand(t *testing.T) {
	root := NewRootCmd()
	stdout, _, err := executeCommand(root, "git")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !strings.Contains(stdout, "setup") {
		t.Errorf("expected git help to list 'setup' subcommand, got: %s", stdout)
	}
}

func TestGitSetupHelp(t *testing.T) {
	root := NewRootCmd()
	stdout, _, err := executeCommand(root, "git", "setup", "--help")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !strings.Contains(stdout, "--name") {
		t.Errorf("expected help to contain '--name', got: %s", stdout)
	}
	if !strings.Contains(stdout, "--email") {
		t.Errorf("expected help to contain '--email', got: %s", stdout)
	}
}

func TestGitSetupNoCreds(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	root := NewRootCmd()
	_, _, err := executeCommand(root, "git", "setup")
	if err == nil {
		t.Fatal("expected error when no credentials found, got nil")
	}
	if !strings.Contains(err.Error(), "no credentials found") &&
		!strings.Contains(err.Error(), "no config found") {
		t.Errorf("expected 'no credentials found' error, got: %v", err)
	}
}

// --- config command tests ---

func TestConfigNoSubcommand(t *testing.T) {
	root := NewRootCmd()
	stdout, _, err := executeCommand(root, "config")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !strings.Contains(stdout, "repair") {
		t.Errorf("expected config help to list 'repair' subcommand, got: %s", stdout)
	}
}

func TestConfigRepairHelp(t *testing.T) {
	root := NewRootCmd()
	stdout, _, err := executeCommand(root, "config", "repair", "--help")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !strings.Contains(stdout, "--dry-run") {
		t.Errorf("expected help to contain '--dry-run', got: %s", stdout)
	}
}

// --- github command tests ---

func TestGitHubNoSubcommand(t *testing.T) {
	root := NewRootCmd()
	stdout, _, err := executeCommand(root, "github")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	for _, sub := range []string{"setup", "credential-helper", "token"} {
		if !strings.Contains(stdout, sub) {
			t.Errorf("expected github help to list '%s' subcommand, got: %s", sub, stdout)
		}
	}
}

func TestGitHubSetupNoCreds(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	root := NewRootCmd()
	_, _, err := executeCommand(root, "github", "setup")
	if err == nil {
		t.Fatal("expected error when no credentials found, got nil")
	}
	if !strings.Contains(err.Error(), "no credentials found") &&
		!strings.Contains(err.Error(), "no config found") {
		t.Errorf("expected 'no credentials found' error, got: %v", err)
	}
}

func TestGitHubTokenHelp(t *testing.T) {
	root := NewRootCmd()
	stdout, _, err := executeCommand(root, "github", "token", "--help")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !strings.Contains(stdout, "GH_TOKEN") {
		t.Errorf("expected help to contain 'GH_TOKEN' example, got: %s", stdout)
	}
}
