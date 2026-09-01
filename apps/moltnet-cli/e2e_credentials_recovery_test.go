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
	secretRoot := t.TempDir()
	t.Setenv(secretRootEnv, secretRoot)
	t.Setenv(secretRootWritableEnv, "1")
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
		"--destination",
		fileProviderName,
	)
	if err != nil {
		t.Fatalf("recover credentials: %v\nstderr: %s", err, stderr)
	}
	if strings.Contains(stdout, agent.Credential.ClientSecret) ||
		strings.Contains(stderr, agent.Credential.ClientSecret) {
		t.Fatal("previous client secret leaked through command output")
	}

	var output recoveredCredentialsOutput
	if err := json.Unmarshal([]byte(stdout), &output); err != nil {
		t.Fatalf("parse recovery output: %v\n%s", err, stdout)
	}
	if output.PersistenceState != "stored" ||
		output.ClientID != agent.Credential.ClientID ||
		output.SecretReference.Provider != fileProviderName ||
		output.RecoveryPath != "" {
		t.Fatalf("unexpected recovery output: %#v", output)
	}

	updated, err := ReadConfigFrom(credentialsPath)
	if err != nil || updated == nil {
		t.Fatalf("read recovered credentials: %v", err)
	}
	if updated.OAuth2.ClientID != agent.Credential.ClientID ||
		updated.OAuth2.ClientSecret != "" || updated.OAuth2.ClientSecretRef == nil ||
		updated.OAuth2.ClientSecretRef.Provider != fileProviderName {
		t.Fatal("credentials file does not contain the recovered secret reference")
	}
	recoveredSecret, err := resolveOAuth2Secret(updated, NewSecretProviderRegistry())
	if err != nil {
		t.Fatalf("resolve recovered secret reference: %v", err)
	}
	if recoveredSecret == "lost-client-secret" || recoveredSecret == agent.Credential.ClientSecret {
		t.Fatal("provider does not contain a distinct recovered secret")
	}
	if strings.Contains(stdout, recoveredSecret) || strings.Contains(stderr, recoveredSecret) {
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
		recoveredSecret,
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
