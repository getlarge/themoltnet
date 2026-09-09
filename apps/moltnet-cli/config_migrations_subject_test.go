package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

type subjectDeleteFailureProvider struct{ *memorySecretProvider }

func (p *subjectDeleteFailureProvider) Delete(string) error {
	return errors.New("keyring unavailable")
}

type subjectStoreFailureProvider struct {
	*memorySecretProvider
	failKey string
}

func (p *subjectStoreFailureProvider) Set(key, value string) error {
	if key == p.failKey {
		return errors.New("keyring unavailable")
	}
	return p.memorySecretProvider.Set(key, value)
}

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

	plan, err := buildConfigMigrationPlan(path, osKeyringProviderName, migrations)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := applyConfigMigrationPlan(plan, osKeyringProviderName, registry, migrations); err != nil {
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
	retry, err := buildConfigMigrationPlan(
		path,
		osKeyringProviderName,
		[]configMigration{newSubjectAnchorMigration(nil)},
	)
	if err != nil || len(retry.Migrations) != 0 {
		t.Fatalf("canonical retry should be a no-op: plan=%+v err=%v", retry, err)
	}
}

func TestSubjectAnchorMigrationReportsPostCommitCleanupAsWarning(t *testing.T) {
	const subjectID = "00000000-0000-4000-8000-000000000217"
	path := writeSubjectMigrationFixture(t, "https://api.example.test", "ed25519:public", "FINGERPRINT")
	provider := &subjectDeleteFailureProvider{&memorySecretProvider{values: map[string]string{
		OAuth2SecretKey("legacy-identity", "client"): "oauth-secret",
		AgentKeyKey("legacy-identity"):               "agent-secret",
	}}}
	registry := NewSecretProviderRegistry()
	registry.Register(osKeyringProviderName, provider)
	verified := &subjectVerification{SubjectID: subjectID, SubjectType: SubjectTypeAgent, PublicKey: "ed25519:public", Fingerprint: "FINGERPRINT"}
	migrations := []configMigration{newSubjectAnchorMigration(verified)}
	plan, err := buildConfigMigrationPlan(path, osKeyringProviderName, migrations)
	if err != nil {
		t.Fatal(err)
	}
	var output bytes.Buffer
	if err := runAndPrintConfigMigrationPlan(&output, plan, osKeyringProviderName, registry, migrations); err != nil {
		t.Fatalf("cleanup warning returned a command error: %v", err)
	}
	var result configMigrationRunOutput
	if err := json.Unmarshal(output.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if len(result.Applied) != 1 || result.Applied[0] != subjectAnchorMigrationID ||
		!result.Changed || !result.ManualRecoveryRequired || result.Failure != nil || len(result.Warnings) != 1 {
		t.Fatalf("result = %+v", result)
	}
	if !bytes.Contains([]byte(result.Warnings[0]), []byte("os-keyring:oauth2/legacy-identity/client")) {
		t.Fatalf("warning lacks remediation reference: %q", result.Warnings[0])
	}
	if !bytes.Contains([]byte(result.Warnings[0]), []byte("os-keyring:agent-key/legacy-identity")) {
		t.Fatalf("warning omits a failed cleanup reference: %q", result.Warnings[0])
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(data, []byte("identity_id")) || !bytes.Contains(data, []byte(subjectID)) {
		t.Fatalf("canonical config was not committed: %s", data)
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
	plan, err := buildConfigMigrationPlan(path, osKeyringProviderName, migrations)
	if err != nil {
		t.Fatal(err)
	}

	if _, err := applyConfigMigrationPlan(plan, osKeyringProviderName, registry, migrations); err == nil {
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

func TestSubjectAnchorMigrationRetainsPartialCopyForRetry(t *testing.T) {
	const subjectID = "00000000-0000-4000-8000-000000000217"
	path := writeSubjectMigrationFixture(t, "https://api.example.test", "ed25519:public", "FINGERPRINT")
	original, _ := os.ReadFile(path)
	provider := &subjectStoreFailureProvider{
		memorySecretProvider: &memorySecretProvider{values: map[string]string{
			OAuth2SecretKey("legacy-identity", "client"): "oauth-secret",
			AgentKeyKey("legacy-identity"):               "agent-secret",
		}},
		failKey: AgentKeyKey(subjectID),
	}
	registry := NewSecretProviderRegistry()
	registry.Register(osKeyringProviderName, provider)
	verified := &subjectVerification{SubjectID: subjectID, SubjectType: SubjectTypeAgent, PublicKey: "ed25519:public", Fingerprint: "FINGERPRINT"}
	migrations := []configMigration{newSubjectAnchorMigration(verified)}
	plan, err := buildConfigMigrationPlan(path, osKeyringProviderName, migrations)
	if err != nil {
		t.Fatal(err)
	}
	var output bytes.Buffer

	err = runAndPrintConfigMigrationPlan(&output, plan, osKeyringProviderName, registry, migrations)
	if err == nil {
		t.Fatal("partial destination copy unexpectedly succeeded")
	}
	var result configMigrationRunOutput
	if err := json.Unmarshal(output.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if result.Failure == nil || result.Failure.Stage != "ensure_destinations" ||
		!result.Failure.Retryable || result.Failure.ManualRecoveryRequired ||
		!result.Changed || result.ManualRecoveryRequired {
		t.Fatalf("failure envelope = %+v", result)
	}
	current, _ := os.ReadFile(path)
	if string(current) != string(original) {
		t.Fatal("credentials changed after a partial destination copy")
	}
	if provider.values[OAuth2SecretKey(subjectID, "client")] != "oauth-secret" {
		t.Fatal("first canonical copy was not retained for retry")
	}
	if _, exists := provider.values[AgentKeyKey(subjectID)]; exists {
		t.Fatal("failed canonical copy unexpectedly exists")
	}
	if provider.values[OAuth2SecretKey("legacy-identity", "client")] != "oauth-secret" ||
		provider.values[AgentKeyKey("legacy-identity")] != "agent-secret" {
		t.Fatal("legacy sources were removed before the canonical config was durable")
	}
}

func TestConfigMigrateDryRunDoesNotAuthenticateOrBindAPlanToOneSubject(t *testing.T) {
	path := writeSubjectMigrationFixture(t, "http://127.0.0.1:1", "ed25519:public", "FINGERPRINT")
	registry, _ := newMemorySecretProviderRegistry()
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
	if len(plan.Migrations) == 0 || plan.Migrations[0].ID != subjectAnchorMigrationID {
		t.Fatalf("subject migration missing from offline plan: %#v", plan.Migrations)
	}
	if _, exists := plan.Parameters["subject_id"]; exists {
		t.Fatalf("offline plan was bound to a subject: %#v", plan.Parameters)
	}
}

func TestConfigMigrateReportsSubjectAuthenticationFailureAsRunOutput(t *testing.T) {
	path := writeSubjectMigrationFixture(t, "http://127.0.0.1:1", "ed25519:public", "FINGERPRINT")
	registry, _ := newMemorySecretProviderRegistry()
	var output bytes.Buffer

	err := runConfigMigrateCmdWithRegistry(
		&output,
		path,
		"",
		"",
		osKeyringProviderName,
		false,
		registry,
		subjectAwareConfigMigrations(osKeyringProviderName),
	)
	if err == nil {
		t.Fatal("subject authentication unexpectedly succeeded")
	}
	if !strings.Contains(err.Error(), "verify config identity") {
		t.Fatalf("command error omitted the authentication cause: %v", err)
	}
	var result configMigrationRunOutput
	if jsonErr := json.Unmarshal(output.Bytes(), &result); jsonErr != nil {
		t.Fatalf("failure output is not JSON: %v\n%s", jsonErr, output.String())
	}
	if result.Failure == nil || result.Failure.Stage != "verify_subject" {
		t.Fatalf("failure = %+v", result.Failure)
	}
	if !strings.Contains(result.Failure.Message, "verify config identity") {
		t.Fatalf("failure omitted the authentication cause: %+v", result.Failure)
	}
}

func TestSubjectAnchorMigrationDoesNotApplyToCredentiallessConfig(t *testing.T) {
	path := filepath.Join(t.TempDir(), "moltnet.json")
	if err := os.WriteFile(path, []byte("{\"keys\":{},\"oauth2\":{},\"endpoints\":{}}"), privateFileMode); err != nil {
		t.Fatal(err)
	}
	plan, err := buildConfigMigrationPlan(
		path,
		osKeyringProviderName,
		[]configMigration{newSubjectAnchorMigration(nil)},
	)
	if err != nil {
		t.Fatal(err)
	}
	if len(plan.Migrations) != 0 {
		t.Fatalf("credentialless config has pending subject migration: %#v", plan.Migrations)
	}
}
