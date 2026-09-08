package main

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func writeSubjectMigrationFixture(t *testing.T, apiURL, publicKey, fingerprint string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "moltnet.json")
	document := `{
  "identity_id": "legacy-identity",
  "oauth2": {"client_id":"client","client_secret_ref":{"provider":"os-keyring","key":"oauth2/legacy-identity/client"}},
  "agent_key_ref": {"provider":"os-keyring","key":"agent-key/legacy-identity"},
  "keys": {"public_key":` + mustJSON(t, publicKey) + `,"fingerprint":` + mustJSON(t, fingerprint) + `},
	  "endpoints": {"api":` + mustJSON(t, apiURL) + `},
  "extension": {"preserved":true}
}`
	if err := os.WriteFile(path, []byte(document), privateFileMode); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestSubjectAnchorMigrationRekeysReferencesAndPreservesExtensions(t *testing.T) {
	const subjectID = "00000000-0000-4000-8000-000000000217"
	path := writeSubjectMigrationFixture(t, "https://api.example.test", "ed25519:public", "FINGERPRINT")
	registry, provider := newMemorySecretProviderRegistry()
	provider.values[OAuth2SecretKey("legacy-identity", "client")] = "oauth-secret"
	provider.values[AgentKeyKey("legacy-identity")] = "agent-secret"
	verified := &subjectVerification{SubjectID: subjectID, SubjectType: SubjectTypeAgent, PublicKey: "ed25519:public", Fingerprint: "FINGERPRINT"}
	migrations := []configMigration{newSubjectAnchorMigration(verified)}

	plan, err := buildConfigMigrationPlan(path, osKeyringProviderName, migrations, verified)
	if err != nil {
		t.Fatal(err)
	}
	if plan.Parameters[migrationSubjectIDParameter] != subjectID || plan.Parameters[migrationSubjectTypeParameter] != "agent" {
		t.Fatalf("plan parameters = %#v", plan.Parameters)
	}
	if _, err := applyConfigMigrationPlan(plan, osKeyringProviderName, registry, migrations, verified); err != nil {
		t.Fatal(err)
	}

	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var document map[string]json.RawMessage
	if err := json.Unmarshal(data, &document); err != nil {
		t.Fatal(err)
	}
	if _, exists := document["identity_id"]; exists {
		t.Fatal("identity_id survived canonical rewrite")
	}
	if _, exists := document["extension"]; !exists {
		t.Fatal("unknown extension was removed")
	}
	creds, err := ReadConfigFrom(path)
	if err != nil {
		t.Fatal(err)
	}
	if creds.SubjectID != subjectID || creds.SubjectType != SubjectTypeAgent {
		t.Fatalf("subject = %q/%q", creds.SubjectType, creds.SubjectID)
	}
	if creds.OAuth2.ClientSecretRef.Key != OAuth2SecretKey(subjectID, "client") || creds.AgentKeyRef.Key != AgentKeyKey(subjectID) {
		t.Fatalf("references = %#v / %#v", creds.OAuth2.ClientSecretRef, creds.AgentKeyRef)
	}
	if provider.values[OAuth2SecretKey(subjectID, "client")] != "oauth-secret" || provider.values[AgentKeyKey(subjectID)] != "agent-secret" {
		t.Fatalf("canonical provider values = %#v", provider.values)
	}
	if _, exists := provider.values[OAuth2SecretKey("legacy-identity", "client")]; exists {
		t.Fatal("legacy OAuth2 entry was not deleted")
	}
	if _, exists := provider.values[AgentKeyKey("legacy-identity")]; exists {
		t.Fatal("legacy agent-key entry was not deleted")
	}
}

func TestSubjectAnchorMigrationRejectsDestinationConflictBeforeRewrite(t *testing.T) {
	const subjectID = "00000000-0000-4000-8000-000000000217"
	path := writeSubjectMigrationFixture(t, "https://api.example.test", "ed25519:public", "FINGERPRINT")
	original, _ := os.ReadFile(path)
	registry, provider := newMemorySecretProviderRegistry()
	provider.values[OAuth2SecretKey("legacy-identity", "client")] = "oauth-secret"
	provider.values[AgentKeyKey("legacy-identity")] = "agent-secret"
	provider.values[OAuth2SecretKey(subjectID, "client")] = "different"
	verified := &subjectVerification{SubjectID: subjectID, SubjectType: SubjectTypeAgent, PublicKey: "ed25519:public", Fingerprint: "FINGERPRINT"}
	migrations := []configMigration{newSubjectAnchorMigration(verified)}
	plan, err := buildConfigMigrationPlan(path, osKeyringProviderName, migrations, verified)
	if err != nil {
		t.Fatal(err)
	}

	if _, err := applyConfigMigrationPlan(plan, osKeyringProviderName, registry, migrations, verified); err == nil {
		t.Fatal("conflicting destination unexpectedly accepted")
	}
	current, _ := os.ReadFile(path)
	if string(current) != string(original) {
		t.Fatal("credentials changed after destination conflict")
	}
	if provider.values[OAuth2SecretKey("legacy-identity", "client")] != "oauth-secret" {
		t.Fatal("legacy source was removed after destination conflict")
	}
}

func TestSubjectAnchorPlanCannotRunForAnotherSubject(t *testing.T) {
	path := writeSubjectMigrationFixture(t, "https://api.example.test", "ed25519:public", "FINGERPRINT")
	registry, provider := newMemorySecretProviderRegistry()
	provider.values[OAuth2SecretKey("legacy-identity", "client")] = "oauth-secret"
	provider.values[AgentKeyKey("legacy-identity")] = "agent-secret"
	first := &subjectVerification{SubjectID: "00000000-0000-4000-8000-000000000217", SubjectType: SubjectTypeAgent, PublicKey: "ed25519:public", Fingerprint: "FINGERPRINT"}
	second := &subjectVerification{SubjectID: "00000000-0000-4000-8000-000000000218", SubjectType: SubjectTypeAgent, PublicKey: "ed25519:public", Fingerprint: "FINGERPRINT"}
	plan, err := buildConfigMigrationPlan(path, osKeyringProviderName, []configMigration{newSubjectAnchorMigration(first)}, first)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := applyConfigMigrationPlan(plan, osKeyringProviderName, registry, []configMigration{newSubjectAnchorMigration(second)}, second); err == nil {
		t.Fatal("cross-subject plan unexpectedly applied")
	}
}

func TestConfigMigrateEncodesAuthenticatedSubjectIntoPlan(t *testing.T) {
	server, answer := startActivationIdentityServer(t)
	path := writeSubjectMigrationFixture(t, server.URL, answer.PublicKey, answer.Fingerprint)
	registry, provider := newMemorySecretProviderRegistry()
	provider.values[OAuth2SecretKey("legacy-identity", "client")] = "oauth-secret"
	provider.values[AgentKeyKey("legacy-identity")] = "agent-secret"
	var output bytes.Buffer

	err := runConfigMigrateCmdWithRegistry(
		&output,
		path,
		"",
		"",
		osKeyringProviderName,
		true,
		registry,
		subjectAwareConfigMigrations(osKeyringProviderName),
	)
	if err != nil {
		t.Fatal(err)
	}
	var plan configMigrationPlan
	if err := json.Unmarshal(output.Bytes(), &plan); err != nil {
		t.Fatal(err)
	}
	if plan.Parameters[migrationSubjectIDParameter] != answer.SubjectID ||
		plan.Parameters[migrationSubjectTypeParameter] != "agent" {
		t.Fatalf("plan parameters = %#v", plan.Parameters)
	}
}
