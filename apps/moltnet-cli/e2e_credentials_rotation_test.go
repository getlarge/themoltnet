//go:build e2e

package main

import (
	"encoding/json"
	"os"
	"strings"
	"testing"
)

// TestE2E_AgentsCredentialsRotate uses its own genesis agent because rotation
// invalidates the old secret immediately. Mutating the package-wide e2e agent
// would make every later CLI test order-dependent.
func TestE2E_AgentsCredentialsRotate(t *testing.T) {
	agent, err := bootstrapGenesisAgent()
	if err != nil {
		t.Fatalf("bootstrap dedicated rotation agent: %v", err)
	}
	credentialsPath, err := writeE2ECredsFile(&CredentialsFile{
		IdentityID: agent.IdentityID,
		OAuth2: CredentialsOAuth2{
			ClientID:     agent.ClientID,
			ClientSecret: agent.ClientSecret,
		},
		Keys: CredentialsKeys{
			PublicKey:   agent.PublicKey,
			PrivateKey:  agent.PrivateKey,
			Fingerprint: agent.Fingerprint,
		},
		Endpoints: CredentialsEndpoints{
			API: e2eAPIURL,
		},
	})
	if err != nil {
		t.Fatalf("write dedicated credentials: %v", err)
	}
	binPath, err := ensureE2ECLIBinary()
	if err != nil {
		t.Fatalf("build CLI: %v", err)
	}

	stdout, stderr, err := runE2ECLI(
		binPath,
		credentialsPath,
		"agents",
		"credentials",
		"rotate",
		"--yes",
	)
	if err != nil {
		t.Fatalf("rotate credentials: %v\nstderr: %s", err, stderr)
	}
	if strings.Contains(stdout, agent.ClientSecret) ||
		strings.Contains(stderr, agent.ClientSecret) {
		t.Fatal("old client secret leaked through command output")
	}

	var output rotateCredentialsOutput
	if err := json.Unmarshal([]byte(stdout), &output); err != nil {
		t.Fatalf("parse rotate output: %v\n%s", err, stdout)
	}
	if !output.CredentialsUpdated ||
		output.CredentialsPath != credentialsPath ||
		output.ClientSecret != "" {
		t.Fatalf("unexpected rotate output: %#v", output)
	}

	updated, err := ReadConfigFrom(credentialsPath)
	if err != nil || updated == nil {
		t.Fatalf("read rotated credentials: %v", err)
	}
	if updated.OAuth2.ClientSecret == "" ||
		updated.OAuth2.ClientSecret == agent.ClientSecret {
		t.Fatal("credentials file does not contain a distinct rotated secret")
	}
	if strings.Contains(stdout, updated.OAuth2.ClientSecret) ||
		strings.Contains(stderr, updated.OAuth2.ClientSecret) {
		t.Fatal("new client secret leaked through default command output")
	}
	info, err := os.Stat(credentialsPath)
	if err != nil {
		t.Fatalf("stat rotated credentials: %v", err)
	}
	if got := info.Mode().Perm(); got != 0o600 {
		t.Fatalf("credentials mode = %o, want 600", got)
	}

	newTokenManager := NewTokenManager(
		e2eAPIURL,
		updated.OAuth2.ClientID,
		updated.OAuth2.ClientSecret,
	)
	if _, err := newTokenManager.GetToken(); err != nil {
		t.Fatalf("new client secret cannot mint a token: %v", err)
	}

	oldTokenManager := NewTokenManager(
		e2eAPIURL,
		agent.ClientID,
		agent.ClientSecret,
	)
	if _, err := oldTokenManager.GetToken(); err == nil {
		t.Fatal("old client secret still mints tokens after rotation")
	}
}
