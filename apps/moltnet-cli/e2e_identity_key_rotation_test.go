//go:build e2e

package main

import (
	"encoding/json"
	"strings"
	"testing"
)

// TestE2E_AgentsIdentityKeyRotate uses its own genesis agent because the
// rotation changes the agent's key for good.
func TestE2E_AgentsIdentityKeyRotate(t *testing.T) {
	agent, err := bootstrapGenesisAgent()
	if err != nil {
		t.Fatalf("bootstrap dedicated rotation agent: %v", err)
	}
	// Rotation writes the new seed where the current one lives, so the seed
	// must be reference-backed in a writable provider.
	t.Setenv(secretRootEnv, t.TempDir())
	t.Setenv(secretRootWritableEnv, "1")
	seedRef := SecretReference{Provider: fileProviderName, Key: IdentitySeedKey(agent.Fingerprint)}
	if err := NewSecretProviderRegistry().Store(seedRef, agent.PrivateKey); err != nil {
		t.Fatalf("store seed: %v", err)
	}
	credentialsPath, err := writeE2ECredsFile(&CredentialsFile{
		SubjectID:   agent.AgentID,
		SubjectType: SubjectTypeAgent,
		OAuth2: CredentialsOAuth2{
			ClientID:     agent.ClientID,
			ClientSecret: agent.ClientSecret,
		},
		Keys: CredentialsKeys{
			PublicKey:     agent.PublicKey,
			PrivateKeyRef: &seedRef,
			Fingerprint:   agent.Fingerprint,
		},
		Endpoints: CredentialsEndpoints{API: e2eAPIURL},
	})
	if err != nil {
		t.Fatalf("write dedicated credentials: %v", err)
	}
	binPath, err := ensureE2ECLIBinary()
	if err != nil {
		t.Fatalf("build CLI: %v", err)
	}

	if _, _, err := runE2ECLI(binPath, credentialsPath, "agents", "identity-key", "rotate"); err == nil {
		t.Fatal("rotation without --yes must be refused")
	}

	stdout, stderr, err := runE2ECLI(binPath, credentialsPath, "agents", "identity-key", "rotate", "--yes")
	if err != nil {
		t.Fatalf("rotate identity key: %v\nstderr: %s", err, stderr)
	}
	if strings.Contains(stdout+stderr, agent.PrivateKey) {
		t.Fatal("the old seed leaked through command output")
	}
	var output identityKeyRotateOutput
	if err := json.Unmarshal([]byte(stdout), &output); err != nil {
		t.Fatalf("parse rotate output: %v\n%s", err, stdout)
	}
	if output.PreviousFingerprint != agent.Fingerprint || output.Fingerprint == agent.Fingerprint || !output.CredentialsUpdated {
		t.Fatalf("unexpected rotate output: %#v", output)
	}

	updated, err := ReadConfigFrom(credentialsPath)
	if err != nil || updated == nil {
		t.Fatalf("read rotated credentials: %v", err)
	}
	if updated.Keys.Fingerprint != output.Fingerprint || updated.Keys.PublicKey != output.PublicKey {
		t.Fatalf("credentials not switched: %+v", updated.Keys)
	}
	newSeed, err := resolveIdentitySeed(updated, NewSecretProviderRegistry())
	if err != nil {
		t.Fatalf("new seed does not resolve and derive the new key: %v", err)
	}
	if strings.Contains(stdout+stderr, newSeed) {
		t.Fatal("the new seed leaked through command output")
	}

	// The server agrees, and the rotated credentials still authenticate.
	whoamiOut, whoamiErr, err := runE2ECLI(binPath, credentialsPath, "agents", "whoami")
	if err != nil {
		t.Fatalf("whoami after rotation: %v\nstderr: %s", err, whoamiErr)
	}
	if !strings.Contains(whoamiOut, output.Fingerprint) {
		t.Fatalf("whoami does not report the new fingerprint:\n%s", whoamiOut)
	}

	// The rotated credentials can rotate again: the second rotation starts
	// from the first new key. (Reusing a retired key is rejected server-side
	// and covered by the REST API e2e suite.)
	stdout, stderr, err = runE2ECLI(binPath, credentialsPath, "agents", "identity-key", "rotate", "--yes")
	if err != nil {
		t.Fatalf("a second rotation should succeed with a fresh key: %v\nstderr: %s", err, stderr)
	}
	var second identityKeyRotateOutput
	if err := json.Unmarshal([]byte(stdout), &second); err != nil {
		t.Fatalf("parse second rotate output: %v", err)
	}
	if second.PreviousFingerprint != output.Fingerprint {
		t.Fatalf("second rotation did not start from the first new key: %#v", second)
	}
}
