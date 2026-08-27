//go:build e2e

package main

import (
	"encoding/json"
	"os"
	"strings"
	"testing"
)

// TestE2E_AgentsCredentialsRecover starts with an unusable local OAuth2
// secret and proves that the identity key alone can replace it. A dedicated
// self-registered agent keeps the immediate server-side rotation isolated
// from the package-wide e2e credentials.
func TestE2E_AgentsCredentialsRecover(t *testing.T) {
	registration, err := DoRegister(e2eAPIURL, credentialTypeOAuth2, "")
	if err != nil {
		t.Fatalf("register dedicated recovery agent: %v", err)
	}
	agent := registration.Response
	keyPair := registration.KeyPair
	credentialsPath, err := writeE2ECredsFile(&CredentialsFile{
		IdentityID: agent.IdentityID,
		OAuth2: CredentialsOAuth2{
			ClientID:     agent.Credential.ClientID,
			ClientSecret: "lost-client-secret",
		},
		Keys: CredentialsKeys{
			PublicKey:   keyPair.PublicKey,
			PrivateKey:  keyPair.PrivateKey,
			Fingerprint: keyPair.Fingerprint,
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
		"recover",
		"--yes",
	)
	if err != nil {
		t.Fatalf("recover credentials: %v\nstderr: %s", err, stderr)
	}
	if strings.Contains(stdout, agent.Credential.ClientSecret) ||
		strings.Contains(stderr, agent.Credential.ClientSecret) {
		t.Fatal("previous client secret leaked through command output")
	}

	var output rotateCredentialsOutput
	if err := json.Unmarshal([]byte(stdout), &output); err != nil {
		t.Fatalf("parse recovery output: %v\n%s", err, stdout)
	}
	if !output.CredentialsUpdated ||
		output.CredentialsPath != credentialsPath ||
		output.ClientID != agent.Credential.ClientID ||
		output.ClientSecret != "" {
		t.Fatalf("unexpected recovery output: %#v", output)
	}

	updated, err := ReadConfigFrom(credentialsPath)
	if err != nil || updated == nil {
		t.Fatalf("read recovered credentials: %v", err)
	}
	if updated.OAuth2.ClientID != agent.Credential.ClientID ||
		updated.OAuth2.ClientSecret == "" ||
		updated.OAuth2.ClientSecret == "lost-client-secret" ||
		updated.OAuth2.ClientSecret == agent.Credential.ClientSecret {
		t.Fatal("credentials file does not contain a distinct recovered secret")
	}
	if strings.Contains(stdout, updated.OAuth2.ClientSecret) ||
		strings.Contains(stderr, updated.OAuth2.ClientSecret) {
		t.Fatal("recovered client secret leaked through command output")
	}
	info, err := os.Stat(credentialsPath)
	if err != nil {
		t.Fatalf("stat recovered credentials: %v", err)
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
		t.Fatalf("recovered client secret cannot mint a token: %v", err)
	}

	oldTokenManager := NewTokenManager(
		e2eAPIURL,
		agent.Credential.ClientID,
		agent.Credential.ClientSecret,
	)
	if _, err := oldTokenManager.GetToken(); err == nil {
		t.Fatal("previous client secret still mints tokens after recovery")
	}
}
