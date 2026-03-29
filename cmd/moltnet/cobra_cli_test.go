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
	t.Parallel()
	root := NewRootCmd("test", "")
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
	t.Parallel()
	root := NewRootCmd("test", "")
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
	t.Parallel()
	root := NewRootCmd("test", "")
	_, _, err := executeCommand(root, "register")
	if err == nil {
		t.Fatal("expected error when voucher is missing, got nil")
	}
	if !strings.Contains(err.Error(), "voucher") {
		t.Errorf("expected error to mention 'voucher', got: %v", err)
	}
}

func TestRegisterHelp(t *testing.T) {
	t.Parallel()
	root := NewRootCmd("test", "")
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
	t.Parallel()
	root := NewRootCmd("test", "")
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
	t.Parallel()
	root := NewRootCmd("test", "")
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
	t.Parallel()
	root := NewRootCmd("test", "")
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
	t.Parallel()
	root := NewRootCmd("test", "")
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
	t.Parallel()
	root := NewRootCmd("test", "")
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
	t.Parallel()
	root := NewRootCmd("test", "")
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
	t.Parallel()
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
	encRoot := NewRootCmd("test", "")
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
	decRoot := NewRootCmd("test", "")
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
	t.Parallel()
	root := NewRootCmd("test", "")
	stdout, _, err := executeCommand(root, "git")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !strings.Contains(stdout, "setup") {
		t.Errorf("expected git help to list 'setup' subcommand, got: %s", stdout)
	}
}

func TestGitSetupHelp(t *testing.T) {
	t.Parallel()
	root := NewRootCmd("test", "")
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
	root := NewRootCmd("test", "")
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
	t.Parallel()
	root := NewRootCmd("test", "")
	stdout, _, err := executeCommand(root, "config")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !strings.Contains(stdout, "repair") {
		t.Errorf("expected config help to list 'repair' subcommand, got: %s", stdout)
	}
}

func TestConfigRepairHelp(t *testing.T) {
	t.Parallel()
	root := NewRootCmd("test", "")
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
	t.Parallel()
	root := NewRootCmd("test", "")
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
	root := NewRootCmd("test", "")
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
	t.Parallel()
	root := NewRootCmd("test", "")
	stdout, _, err := executeCommand(root, "github", "token", "--help")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !strings.Contains(stdout, "GH_TOKEN") {
		t.Errorf("expected help to contain 'GH_TOKEN' example, got: %s", stdout)
	}
}

// --- agents command tests ---

func TestAgentsNoSubcommand(t *testing.T) {
	t.Parallel()
	root := NewRootCmd("test", "")
	stdout, _, err := executeCommand(root, "agents")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !strings.Contains(stdout, "whoami") {
		t.Errorf("expected agents help to list 'whoami' subcommand, got: %s", stdout)
	}
	if !strings.Contains(stdout, "lookup") {
		t.Errorf("expected agents help to list 'lookup' subcommand, got: %s", stdout)
	}
}

func TestAgentsLookupRequiresArg(t *testing.T) {
	t.Parallel()
	root := NewRootCmd("test", "")
	_, _, err := executeCommand(root, "agents", "lookup")
	if err == nil {
		t.Fatal("expected error when fingerprint arg is missing, got nil")
	}
	if !strings.Contains(err.Error(), "accepts 1 arg") {
		t.Errorf("expected error to mention 'accepts 1 arg', got: %v", err)
	}
}

func TestAgentsWhoamiNoCreds(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	root := NewRootCmd("test", "")
	_, _, err := executeCommand(root, "agents", "whoami")
	if err == nil {
		t.Fatal("expected error when no credentials found, got nil")
	}
	if !strings.Contains(err.Error(), "no credentials found") &&
		!strings.Contains(err.Error(), "no config found") {
		t.Errorf("expected 'no credentials found' error, got: %v", err)
	}
}

func TestAgentsLookupNoCreds(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	root := NewRootCmd("test", "")
	_, _, err := executeCommand(root, "agents", "lookup", "A1B2-C3D4-E5F6-A1B2")
	if err == nil {
		t.Fatal("expected error when no credentials found, got nil")
	}
	if !strings.Contains(err.Error(), "no credentials found") &&
		!strings.Contains(err.Error(), "no config found") {
		t.Errorf("expected 'no credentials found' error, got: %v", err)
	}
}

// --- crypto command tests ---

func TestCryptoNoSubcommand(t *testing.T) {
	t.Parallel()
	root := NewRootCmd("test", "")
	stdout, _, err := executeCommand(root, "crypto")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !strings.Contains(stdout, "identity") {
		t.Errorf("expected crypto help to list 'identity' subcommand, got: %s", stdout)
	}
	if !strings.Contains(stdout, "verify") {
		t.Errorf("expected crypto help to list 'verify' subcommand, got: %s", stdout)
	}
}

func TestCryptoVerifyRequiresSignature(t *testing.T) {
	t.Parallel()
	root := NewRootCmd("test", "")
	_, _, err := executeCommand(root, "crypto", "verify")
	if err == nil {
		t.Fatal("expected error when --signature is missing, got nil")
	}
	if !strings.Contains(err.Error(), "signature") {
		t.Errorf("expected error to mention 'signature', got: %v", err)
	}
}

func TestCryptoIdentityNoCreds(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	root := NewRootCmd("test", "")
	_, _, err := executeCommand(root, "crypto", "identity")
	if err == nil {
		t.Fatal("expected error when no credentials found, got nil")
	}
	if !strings.Contains(err.Error(), "no credentials found") &&
		!strings.Contains(err.Error(), "no config found") {
		t.Errorf("expected 'no credentials found' error, got: %v", err)
	}
}

// --- vouch command tests ---

func TestVouchNoSubcommand(t *testing.T) {
	t.Parallel()
	root := NewRootCmd("test", "")
	stdout, _, err := executeCommand(root, "vouch")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !strings.Contains(stdout, "issue") {
		t.Errorf("expected vouch help to list 'issue' subcommand, got: %s", stdout)
	}
	if !strings.Contains(stdout, "list") {
		t.Errorf("expected vouch help to list 'list' subcommand, got: %s", stdout)
	}
}

func TestVouchIssueNoCreds(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	root := NewRootCmd("test", "")
	_, _, err := executeCommand(root, "vouch", "issue")
	if err == nil {
		t.Fatal("expected error when no credentials found, got nil")
	}
	if !strings.Contains(err.Error(), "no credentials found") &&
		!strings.Contains(err.Error(), "no config found") {
		t.Errorf("expected 'no credentials found' error, got: %v", err)
	}
}

func TestVouchListNoCreds(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	root := NewRootCmd("test", "")
	_, _, err := executeCommand(root, "vouch", "list")
	if err == nil {
		t.Fatal("expected error when no credentials found, got nil")
	}
	if !strings.Contains(err.Error(), "no credentials found") &&
		!strings.Contains(err.Error(), "no config found") {
		t.Errorf("expected 'no credentials found' error, got: %v", err)
	}
}

// --- diary command tests (diary-level) ---

func TestDiaryNoSubcommand(t *testing.T) {
	t.Parallel()
	root := NewRootCmd("test", "")
	stdout, _, err := executeCommand(root, "diary")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	for _, sub := range []string{"list", "create", "get", "tags", "compile"} {
		if !strings.Contains(stdout, sub) {
			t.Errorf("expected diary help to list '%s' subcommand, got: %s", sub, stdout)
		}
	}
}

func TestDiaryListHelp(t *testing.T) {
	t.Parallel()
	root := NewRootCmd("test", "")
	stdout, _, err := executeCommand(root, "diary", "list", "--help")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !strings.Contains(stdout, "List all") {
		t.Errorf("expected diary list help to mention listing, got: %s", stdout)
	}
}

func TestDiaryCreateRequiresName(t *testing.T) {
	t.Parallel()
	root := NewRootCmd("test", "")
	_, _, err := executeCommand(root, "diary", "create")
	if err == nil {
		t.Fatal("expected error when --name is missing, got nil")
	}
	if !strings.Contains(err.Error(), "name") {
		t.Errorf("expected error to mention 'name', got: %v", err)
	}
}

func TestDiaryGetRequiresArg(t *testing.T) {
	t.Parallel()
	root := NewRootCmd("test", "")
	_, _, err := executeCommand(root, "diary", "get")
	if err == nil {
		t.Fatal("expected error when diary-id arg is missing, got nil")
	}
	if !strings.Contains(err.Error(), "accepts 1 arg") {
		t.Errorf("expected error to mention 'accepts 1 arg', got: %v", err)
	}
}

func TestDiaryTagsRequiresArg(t *testing.T) {
	t.Parallel()
	root := NewRootCmd("test", "")
	_, _, err := executeCommand(root, "diary", "tags")
	if err == nil {
		t.Fatal("expected error when diary-id arg is missing, got nil")
	}
	if !strings.Contains(err.Error(), "accepts 1 arg") {
		t.Errorf("expected error to mention 'accepts 1 arg', got: %v", err)
	}
}

func TestDiaryCompileRequiresBudget(t *testing.T) {
	t.Parallel()
	root := NewRootCmd("test", "")
	_, _, err := executeCommand(root, "diary", "compile", "00000000-0000-0000-0000-000000000001")
	if err == nil {
		t.Fatal("expected error when --token-budget is missing, got nil")
	}
	if !strings.Contains(err.Error(), "token-budget") {
		t.Errorf("expected error to mention 'token-budget', got: %v", err)
	}
}

func TestDiaryCompileHelp(t *testing.T) {
	t.Parallel()
	root := NewRootCmd("test", "")
	stdout, _, err := executeCommand(root, "diary", "compile", "--help")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	for _, flag := range []string{"--token-budget", "--task-prompt", "--include-tags", "--exclude-tags"} {
		if !strings.Contains(stdout, flag) {
			t.Errorf("expected compile help to contain %q, got: %s", flag, stdout)
		}
	}
	if !strings.Contains(stdout, "Example") {
		t.Errorf("expected compile help to contain 'Example', got: %s", stdout)
	}
}

// --- entry command tests (entry-level) ---

func TestEntryNoSubcommand(t *testing.T) {
	t.Parallel()
	root := NewRootCmd("test", "")
	stdout, _, err := executeCommand(root, "entry")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	for _, sub := range []string{"create", "create-signed", "list", "get", "update", "delete", "search", "verify", "commit"} {
		if !strings.Contains(stdout, sub) {
			t.Errorf("expected entry help to list '%s' subcommand, got: %s", sub, stdout)
		}
	}
}

func TestEntryCreateRequiresDiaryID(t *testing.T) {
	t.Parallel()
	root := NewRootCmd("test", "")
	_, _, err := executeCommand(root, "entry", "create", "--content", "hello")
	if err == nil {
		t.Fatal("expected error when --diary-id is missing, got nil")
	}
	if !strings.Contains(err.Error(), "diary-id") {
		t.Errorf("expected error to mention 'diary-id', got: %v", err)
	}
}

func TestEntryCreateRequiresContent(t *testing.T) {
	t.Parallel()
	root := NewRootCmd("test", "")
	_, _, err := executeCommand(root, "entry", "create", "--diary-id", "00000000-0000-0000-0000-000000000001")
	if err == nil {
		t.Fatal("expected error when --content is missing, got nil")
	}
	if !strings.Contains(err.Error(), "content") {
		t.Errorf("expected error to mention 'content', got: %v", err)
	}
}

func TestEntryListRequiresDiaryID(t *testing.T) {
	t.Parallel()
	root := NewRootCmd("test", "")
	_, _, err := executeCommand(root, "entry", "list")
	if err == nil {
		t.Fatal("expected error when --diary-id is missing, got nil")
	}
	if !strings.Contains(err.Error(), "diary-id") {
		t.Errorf("expected error to mention 'diary-id', got: %v", err)
	}
}

func TestEntryListHelp(t *testing.T) {
	t.Parallel()
	root := NewRootCmd("test", "")
	stdout, _, err := executeCommand(root, "entry", "list", "--help")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	for _, flag := range []string{"--diary-id", "--tags", "--exclude-tags", "--entry-type", "--limit", "--offset"} {
		if !strings.Contains(stdout, flag) {
			t.Errorf("expected entry list help to contain %q, got: %s", flag, stdout)
		}
	}
}

func TestEntryGetRequiresArg(t *testing.T) {
	t.Parallel()
	root := NewRootCmd("test", "")
	_, _, err := executeCommand(root, "entry", "get")
	if err == nil {
		t.Fatal("expected error when entry-id arg is missing, got nil")
	}
	if !strings.Contains(err.Error(), "accepts 1 arg") {
		t.Errorf("expected error to mention 'accepts 1 arg', got: %v", err)
	}
}

func TestEntryUpdateRequiresArg(t *testing.T) {
	t.Parallel()
	root := NewRootCmd("test", "")
	_, _, err := executeCommand(root, "entry", "update")
	if err == nil {
		t.Fatal("expected error when entry-id arg is missing, got nil")
	}
	if !strings.Contains(err.Error(), "accepts 1 arg") {
		t.Errorf("expected error to mention 'accepts 1 arg', got: %v", err)
	}
}

func TestEntryUpdateHelp(t *testing.T) {
	t.Parallel()
	root := NewRootCmd("test", "")
	stdout, _, err := executeCommand(root, "entry", "update", "--help")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	for _, flag := range []string{"--content", "--title", "--type", "--tags", "--importance"} {
		if !strings.Contains(stdout, flag) {
			t.Errorf("expected entry update help to contain %q, got: %s", flag, stdout)
		}
	}
}

func TestEntryDeleteRequiresArg(t *testing.T) {
	t.Parallel()
	root := NewRootCmd("test", "")
	_, _, err := executeCommand(root, "entry", "delete")
	if err == nil {
		t.Fatal("expected error when entry-id arg is missing, got nil")
	}
	if !strings.Contains(err.Error(), "accepts 1 arg") {
		t.Errorf("expected error to mention 'accepts 1 arg', got: %v", err)
	}
}

func TestEntrySearchRequiresQuery(t *testing.T) {
	t.Parallel()
	root := NewRootCmd("test", "")
	_, _, err := executeCommand(root, "entry", "search")
	if err == nil {
		t.Fatal("expected error when --query is missing, got nil")
	}
	if !strings.Contains(err.Error(), "query") {
		t.Errorf("expected error to mention 'query', got: %v", err)
	}
}

func TestEntryVerifyRequiresArg(t *testing.T) {
	t.Parallel()
	root := NewRootCmd("test", "")
	_, _, err := executeCommand(root, "entry", "verify")
	if err == nil {
		t.Fatal("expected error when entry-id arg is missing, got nil")
	}
	if !strings.Contains(err.Error(), "accepts 1 arg") {
		t.Errorf("expected error to mention 'accepts 1 arg', got: %v", err)
	}
}

func TestEntryCommitRequiresAllFlags(t *testing.T) {
	t.Parallel()
	// Each test omits one required flag
	tests := []struct {
		name    string
		args    []string
		wantErr string
	}{
		{
			name:    "missing diary-id",
			args:    []string{"entry", "commit", "--rationale", "text", "--risk", "low", "--scope", "cli", "--operator", "ed", "--tool", "claude"},
			wantErr: "diary-id",
		},
		{
			name:    "missing rationale",
			args:    []string{"entry", "commit", "--diary-id", "00000000-0000-0000-0000-000000000001", "--risk", "low", "--scope", "cli", "--operator", "ed", "--tool", "claude"},
			wantErr: "rationale",
		},
		{
			name:    "missing risk",
			args:    []string{"entry", "commit", "--diary-id", "00000000-0000-0000-0000-000000000001", "--rationale", "text", "--scope", "cli", "--operator", "ed", "--tool", "claude"},
			wantErr: "risk",
		},
		{
			name:    "missing scope",
			args:    []string{"entry", "commit", "--diary-id", "00000000-0000-0000-0000-000000000001", "--rationale", "text", "--risk", "low", "--operator", "ed", "--tool", "claude"},
			wantErr: "scope",
		},
		{
			name:    "missing operator",
			args:    []string{"entry", "commit", "--diary-id", "00000000-0000-0000-0000-000000000001", "--rationale", "text", "--risk", "low", "--scope", "cli", "--tool", "claude"},
			wantErr: "operator",
		},
		{
			name:    "missing tool",
			args:    []string{"entry", "commit", "--diary-id", "00000000-0000-0000-0000-000000000001", "--rationale", "text", "--risk", "low", "--scope", "cli", "--operator", "ed"},
			wantErr: "tool",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			root := NewRootCmd("test", "")
			_, _, err := executeCommand(root, tt.args...)
			if err == nil {
				t.Fatal("expected error, got nil")
			}
			if !strings.Contains(err.Error(), tt.wantErr) {
				t.Errorf("expected error to mention %q, got: %v", tt.wantErr, err)
			}
		})
	}
}

func TestEntryCommitHelpShowsExamples(t *testing.T) {
	t.Parallel()
	root := NewRootCmd("test", "")
	stdout, _, err := executeCommand(root, "entry", "commit", "--help")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	for _, flag := range []string{"--diary-id", "--rationale", "--risk", "--scope", "--operator", "--tool"} {
		if !strings.Contains(stdout, flag) {
			t.Errorf("expected commit help to contain %q, got: %s", flag, stdout)
		}
	}
	if !strings.Contains(stdout, "Example") {
		t.Errorf("expected commit help to contain 'Example', got: %s", stdout)
	}
}

func TestEntryCreateSignedHelpShowsTypes(t *testing.T) {
	t.Parallel()
	root := NewRootCmd("test", "")
	stdout, _, err := executeCommand(root, "entry", "create-signed", "--help")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	for _, entryType := range []string{"semantic", "episodic", "procedural", "reflection", "identity", "soul"} {
		if !strings.Contains(stdout, entryType) {
			t.Errorf("expected create-signed help to mention entry type %q, got: %s", entryType, stdout)
		}
	}
}

// --- pack command tests ---

func TestPackNoSubcommand(t *testing.T) {
	t.Parallel()
	root := NewRootCmd("test", "")
	stdout, _, err := executeCommand(root, "pack")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !strings.Contains(stdout, "export") {
		t.Errorf("expected pack help to list 'export' subcommand, got: %s", stdout)
	}
	if !strings.Contains(stdout, "provenance") {
		t.Errorf("expected pack help to list 'provenance' subcommand, got: %s", stdout)
	}
	if !strings.Contains(stdout, "create") {
		t.Errorf("expected pack help to list 'create' subcommand, got: %s", stdout)
	}
	if !strings.Contains(stdout, "update") {
		t.Errorf("expected pack help to list 'update' subcommand, got: %s", stdout)
	}
}

func TestPackExportRequiresArg(t *testing.T) {
	t.Parallel()
	root := NewRootCmd("test", "")
	_, _, err := executeCommand(root, "pack", "export")
	if err == nil {
		t.Fatal("expected error when pack-uuid arg is missing, got nil")
	}
	if !strings.Contains(err.Error(), "accepts 1 arg") {
		t.Errorf("expected error to mention 'accepts 1 arg', got: %v", err)
	}
}

func TestPackExportHelp(t *testing.T) {
	t.Parallel()
	root := NewRootCmd("test", "")
	stdout, _, err := executeCommand(root, "pack", "export", "--help")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !strings.Contains(stdout, "--out") {
		t.Errorf("expected help to contain '--out', got: %s", stdout)
	}
}

func TestPackProvenanceRequiresOneSelector(t *testing.T) {
	t.Parallel()
	root := NewRootCmd("test", "")
	_, _, err := executeCommand(root, "pack", "provenance")
	if err == nil {
		t.Fatal("expected error when neither --pack-id nor --pack-cid is provided, got nil")
	}
	if !strings.Contains(err.Error(), "exactly one") {
		t.Errorf("expected error to mention 'exactly one', got: %v", err)
	}
}

func TestPackProvenanceBothSelectors(t *testing.T) {
	t.Parallel()
	root := NewRootCmd("test", "")
	_, _, err := executeCommand(root, "pack", "provenance",
		"--pack-id", "00000000-0000-0000-0000-000000000000",
		"--pack-cid", "bafy123")
	if err == nil {
		t.Fatal("expected error when both --pack-id and --pack-cid are provided, got nil")
	}
	if !strings.Contains(err.Error(), "exactly one") {
		t.Errorf("expected error to mention 'exactly one', got: %v", err)
	}
}

func TestPackProvenanceHelp(t *testing.T) {
	t.Parallel()
	root := NewRootCmd("test", "")
	stdout, _, err := executeCommand(root, "pack", "provenance", "--help")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !strings.Contains(stdout, "--depth") {
		t.Errorf("expected help to contain '--depth', got: %s", stdout)
	}
	if !strings.Contains(stdout, "--share-url") {
		t.Errorf("expected help to contain '--share-url', got: %s", stdout)
	}
}

func TestPackCreateRequiresFlags(t *testing.T) {
	t.Parallel()
	root := NewRootCmd("test", "")
	_, _, err := executeCommand(root, "pack", "create")
	if err == nil {
		t.Fatal("expected error when --diary-id and --entries are missing, got nil")
	}
	if !strings.Contains(err.Error(), "diary-id") {
		t.Errorf("expected error to mention 'diary-id', got: %v", err)
	}
}

func TestPackCreateHelp(t *testing.T) {
	t.Parallel()
	root := NewRootCmd("test", "")
	stdout, _, err := executeCommand(root, "pack", "create", "--help")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !strings.Contains(stdout, "--entries") {
		t.Errorf("expected help to contain '--entries', got: %s", stdout)
	}
	if !strings.Contains(stdout, "entryId") {
		t.Errorf("expected help to show JSON format with 'entryId', got: %s", stdout)
	}
}

func TestPackUpdateRequiresPackID(t *testing.T) {
	t.Parallel()
	root := NewRootCmd("test", "")
	_, _, err := executeCommand(root, "pack", "update")
	if err == nil {
		t.Fatal("expected error when --pack-id is missing, got nil")
	}
	if !strings.Contains(err.Error(), "pack-id") {
		t.Errorf("expected error to mention 'pack-id', got: %v", err)
	}
}

func TestPackUpdateHelp(t *testing.T) {
	t.Parallel()
	root := NewRootCmd("test", "")
	stdout, _, err := executeCommand(root, "pack", "update", "--help")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !strings.Contains(stdout, "--pinned") {
		t.Errorf("expected help to contain '--pinned', got: %s", stdout)
	}
	if !strings.Contains(stdout, "--expires-at") {
		t.Errorf("expected help to contain '--expires-at', got: %s", stdout)
	}
}

// --- relations command tests ---

func TestRelationsNoSubcommand(t *testing.T) {
	t.Parallel()
	root := NewRootCmd("test", "")
	stdout, _, err := executeCommand(root, "relations")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	for _, sub := range []string{"create", "list", "update", "delete"} {
		if !strings.Contains(stdout, sub) {
			t.Errorf("expected relations help to list '%s' subcommand, got: %s", sub, stdout)
		}
	}
}

func TestRelationsCreateRequiresFlags(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name    string
		args    []string
		wantErr string
	}{
		{
			name:    "missing entry-id",
			args:    []string{"relations", "create", "--target-id", "00000000-0000-0000-0000-000000000001", "--relation", "supersedes"},
			wantErr: "entry-id",
		},
		{
			name:    "missing target-id",
			args:    []string{"relations", "create", "--entry-id", "00000000-0000-0000-0000-000000000001", "--relation", "supersedes"},
			wantErr: "target-id",
		},
		{
			name:    "missing relation",
			args:    []string{"relations", "create", "--entry-id", "00000000-0000-0000-0000-000000000001", "--target-id", "00000000-0000-0000-0000-000000000002"},
			wantErr: "relation",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			root := NewRootCmd("test", "")
			_, _, err := executeCommand(root, tt.args...)
			if err == nil {
				t.Fatal("expected error, got nil")
			}
			if !strings.Contains(err.Error(), tt.wantErr) {
				t.Errorf("expected error to mention %q, got: %v", tt.wantErr, err)
			}
		})
	}
}

func TestRelationsListRequiresEntryID(t *testing.T) {
	t.Parallel()
	root := NewRootCmd("test", "")
	_, _, err := executeCommand(root, "relations", "list")
	if err == nil {
		t.Fatal("expected error when --entry-id is missing, got nil")
	}
	if !strings.Contains(err.Error(), "entry-id") {
		t.Errorf("expected error to mention 'entry-id', got: %v", err)
	}
}

func TestRelationsUpdateRequiresFlags(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name    string
		args    []string
		wantErr string
	}{
		{
			name:    "missing relation-id",
			args:    []string{"relations", "update", "--status", "accepted"},
			wantErr: "relation-id",
		},
		{
			name:    "missing status",
			args:    []string{"relations", "update", "--relation-id", "00000000-0000-0000-0000-000000000001"},
			wantErr: "status",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			root := NewRootCmd("test", "")
			_, _, err := executeCommand(root, tt.args...)
			if err == nil {
				t.Fatal("expected error, got nil")
			}
			if !strings.Contains(err.Error(), tt.wantErr) {
				t.Errorf("expected error to mention %q, got: %v", tt.wantErr, err)
			}
		})
	}
}

func TestRelationsDeleteRequiresRelationID(t *testing.T) {
	t.Parallel()
	root := NewRootCmd("test", "")
	_, _, err := executeCommand(root, "relations", "delete")
	if err == nil {
		t.Fatal("expected error when --relation-id is missing, got nil")
	}
	if !strings.Contains(err.Error(), "relation-id") {
		t.Errorf("expected error to mention 'relation-id', got: %v", err)
	}
}

func TestRelationsCreateHelp(t *testing.T) {
	t.Parallel()
	root := NewRootCmd("test", "")
	stdout, _, err := executeCommand(root, "relations", "create", "--help")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	for _, flag := range []string{"--entry-id", "--target-id", "--relation", "--status"} {
		if !strings.Contains(stdout, flag) {
			t.Errorf("expected relations create help to contain %q, got: %s", flag, stdout)
		}
	}
	if !strings.Contains(stdout, "Example") {
		t.Errorf("expected relations create help to contain 'Example', got: %s", stdout)
	}
}

// --- completion command tests ---

func TestCompletionBash(t *testing.T) {
	t.Parallel()
	root := NewRootCmd("test", "")
	stdout, _, err := executeCommand(root, "completion", "bash")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if stdout == "" {
		t.Error("expected non-empty bash completion output")
	}
}

func TestCompletionZsh(t *testing.T) {
	t.Parallel()
	root := NewRootCmd("test", "")
	stdout, _, err := executeCommand(root, "completion", "zsh")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if stdout == "" {
		t.Error("expected non-empty zsh completion output")
	}
}

func TestCompletionInvalidShell(t *testing.T) {
	t.Parallel()
	root := NewRootCmd("test", "")
	_, _, err := executeCommand(root, "completion", "invalid")
	if err == nil {
		t.Fatal("expected error for invalid shell, got nil")
	}
}

// --- Issue 1: entry commit output goes through io.Writer, not os.Stdout ---

func TestEntryCommitAcceptsWriter(t *testing.T) {
	t.Parallel()
	// Verify runEntryCommitCmd accepts an io.Writer as first parameter.
	// We can't call it without a real API, but we can verify the function
	// signature compiles correctly by calling with invalid input that fails
	// before reaching the API.
	var buf strings.Builder
	err := runEntryCommitCmd(&buf, "http://127.0.0.1:1", "", "not-a-uuid", "rationale", "low", "cli", "ed", "claude", "", false, 0, "")
	if err == nil {
		t.Fatal("expected error for invalid diary ID")
	}
	// Verify nothing was written to the buffer (error happened before output)
	if buf.Len() != 0 {
		t.Errorf("expected no output on error, got: %s", buf.String())
	}
}

// --- Issue 3+4: --credentials flag is plumbed through ---

func TestCredentialsFlagPlumbedToAgentsWhoami(t *testing.T) {
	// Create a valid credentials file with OAuth2 creds pointing at unreachable API
	kp, err := GenerateKeyPair()
	if err != nil {
		t.Fatalf("generate keypair: %v", err)
	}
	dir := t.TempDir()
	credPath := filepath.Join(dir, "creds.json")
	creds := CredentialsFile{
		IdentityID: "test",
		Keys:       CredentialsKeys{PublicKey: kp.PublicKey, PrivateKey: kp.PrivateKey},
		OAuth2:     CredentialsOAuth2{ClientID: "cid", ClientSecret: "csec"},
	}
	data, _ := json.Marshal(creds)
	os.WriteFile(credPath, data, 0o600)

	// Use empty HOME so default discovery fails, proving --credentials is used
	t.Setenv("HOME", t.TempDir())
	root := NewRootCmd("test", "")
	_, _, err = executeCommand(root, "agents", "whoami",
		"--credentials", credPath,
		"--api-url", "http://127.0.0.1:1")
	if err == nil {
		t.Fatal("expected error for unreachable API, got nil")
	}
	// Should fail with connection error, NOT "no credentials found"
	if strings.Contains(err.Error(), "no credentials found") {
		t.Errorf("credentials flag was ignored — got 'no credentials found' instead of connection error: %v", err)
	}
}

func TestCredentialsFlagPlumbedToVouchList(t *testing.T) {
	kp, err := GenerateKeyPair()
	if err != nil {
		t.Fatalf("generate keypair: %v", err)
	}
	dir := t.TempDir()
	credPath := filepath.Join(dir, "creds.json")
	creds := CredentialsFile{
		IdentityID: "test",
		Keys:       CredentialsKeys{PublicKey: kp.PublicKey, PrivateKey: kp.PrivateKey},
		OAuth2:     CredentialsOAuth2{ClientID: "cid", ClientSecret: "csec"},
	}
	data, _ := json.Marshal(creds)
	os.WriteFile(credPath, data, 0o600)

	t.Setenv("HOME", t.TempDir())
	root := NewRootCmd("test", "")
	_, _, err = executeCommand(root, "vouch", "list",
		"--credentials", credPath,
		"--api-url", "http://127.0.0.1:1")
	if err == nil {
		t.Fatal("expected error for unreachable API, got nil")
	}
	if strings.Contains(err.Error(), "no credentials found") {
		t.Errorf("credentials flag was ignored — got 'no credentials found' instead of connection error: %v", err)
	}
}

func TestCredentialsFlagPlumbedToEntryCreate(t *testing.T) {
	kp, err := GenerateKeyPair()
	if err != nil {
		t.Fatalf("generate keypair: %v", err)
	}
	dir := t.TempDir()
	credPath := filepath.Join(dir, "creds.json")
	creds := CredentialsFile{
		IdentityID: "test",
		Keys:       CredentialsKeys{PublicKey: kp.PublicKey, PrivateKey: kp.PrivateKey},
		OAuth2:     CredentialsOAuth2{ClientID: "cid", ClientSecret: "csec"},
	}
	data, _ := json.Marshal(creds)
	os.WriteFile(credPath, data, 0o600)

	t.Setenv("HOME", t.TempDir())
	root := NewRootCmd("test", "")
	_, _, err = executeCommand(root, "entry", "create",
		"--diary-id", "00000000-0000-0000-0000-000000000001",
		"--content", "test",
		"--credentials", credPath,
		"--api-url", "http://127.0.0.1:1")
	if err == nil {
		t.Fatal("expected error for unreachable API, got nil")
	}
	if strings.Contains(err.Error(), "no credentials found") {
		t.Errorf("credentials flag was ignored — got 'no credentials found' instead of connection error: %v", err)
	}
}

func TestCredentialsFlagPlumbedToSignRequestID(t *testing.T) {
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
		OAuth2: CredentialsOAuth2{
			ClientID:     "test-client",
			ClientSecret: "test-secret",
		},
	}
	data, _ := json.Marshal(creds)
	os.WriteFile(credPath, data, 0o600)

	root := NewRootCmd("test", "")
	// This will fail at the API call, but that's fine — we're testing that
	// the credentials from --credentials are actually loaded (not default path).
	_, _, err = executeCommand(root, "sign",
		"--credentials", credPath,
		"--request-id", "00000000-0000-0000-0000-000000000001",
		"--api-url", "http://127.0.0.1:1")
	if err == nil {
		t.Fatal("expected error for unreachable API, got nil")
	}
	// The error should be about connection, not about missing credentials
	if strings.Contains(err.Error(), "no credentials found") {
		t.Errorf("credentials flag was ignored — got 'no credentials found' error: %v", err)
	}
}

// --- Issue 5: vouch has examples ---

func TestVouchIssueHelpShowsExample(t *testing.T) {
	t.Parallel()
	root := NewRootCmd("test", "")
	stdout, _, err := executeCommand(root, "vouch", "issue", "--help")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !strings.Contains(stdout, "Example") {
		t.Errorf("expected vouch issue help to contain 'Example', got: %s", stdout)
	}
	if !strings.Contains(stdout, "moltnet vouch issue") {
		t.Errorf("expected vouch issue help to contain example command, got: %s", stdout)
	}
}

func TestVouchListHelpShowsExample(t *testing.T) {
	t.Parallel()
	root := NewRootCmd("test", "")
	stdout, _, err := executeCommand(root, "vouch", "list", "--help")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !strings.Contains(stdout, "Example") {
		t.Errorf("expected vouch list help to contain 'Example', got: %s", stdout)
	}
	if !strings.Contains(stdout, "moltnet vouch list") {
		t.Errorf("expected vouch list help to contain example command, got: %s", stdout)
	}
}

// --- Issue 6: crypto verify uses MarkFlagRequired ---

func TestCryptoVerifyRequiresSignatureViaMarkFlagRequired(t *testing.T) {
	t.Parallel()
	root := NewRootCmd("test", "")
	_, _, err := executeCommand(root, "crypto", "verify")
	if err == nil {
		t.Fatal("expected error when --signature is missing, got nil")
	}
	// MarkFlagRequired produces: "required flag(s) \"signature\" not set"
	if !strings.Contains(err.Error(), "required") && !strings.Contains(err.Error(), "signature") {
		t.Errorf("expected Cobra required-flag error mentioning 'signature', got: %v", err)
	}
}

// --- Issue 7: error messages use double-dash ---

func TestValidateCommitFlagsErrorFormat(t *testing.T) {
	t.Parallel()
	// Call validateCommitFlags with empty diary-id, verify error contains "--diary-id" not "-diary-id"
	err := validateCommitFlags("", "text", "low", "cli", "ed", "claude", 0)
	if err == nil {
		t.Fatal("expected error for empty diary-id")
	}
	if !strings.Contains(err.Error(), "--diary-id") {
		t.Errorf("expected error to contain '--diary-id' (double dash), got: %v", err)
	}

	// Verify other flags also use double-dash
	tests := []struct {
		name    string
		fn      func() error
		wantSub string
	}{
		{"rationale", func() error {
			return validateCommitFlags("00000000-0000-0000-0000-000000000001", "", "low", "cli", "ed", "claude", 0)
		}, "--rationale"},
		{"risk", func() error {
			return validateCommitFlags("00000000-0000-0000-0000-000000000001", "text", "", "cli", "ed", "claude", 0)
		}, "--risk"},
		{"scope", func() error {
			return validateCommitFlags("00000000-0000-0000-0000-000000000001", "text", "low", "", "ed", "claude", 0)
		}, "--scope"},
		{"operator", func() error {
			return validateCommitFlags("00000000-0000-0000-0000-000000000001", "text", "low", "cli", "", "claude", 0)
		}, "--operator"},
		{"tool", func() error {
			return validateCommitFlags("00000000-0000-0000-0000-000000000001", "text", "low", "cli", "ed", "", 0)
		}, "--tool"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := tt.fn()
			if err == nil {
				t.Fatal("expected error")
			}
			if !strings.Contains(err.Error(), tt.wantSub) {
				t.Errorf("expected error to contain %q, got: %v", tt.wantSub, err)
			}
		})
	}
}
