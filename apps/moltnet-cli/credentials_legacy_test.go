package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func legacyCredentialsForTest(identityID string) *CredentialsFile {
	return &CredentialsFile{legacyIdentityID: identityID}
}

func addLegacyIdentityToConfigFile(t *testing.T, path, identityID string) {
	t.Helper()
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var document map[string]json.RawMessage
	if err := json.Unmarshal(data, &document); err != nil {
		t.Fatal(err)
	}
	document["identity_id"], _ = json.Marshal(identityID)
	data, err = json.MarshalIndent(document, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, append(data, '\n'), privateFileMode); err != nil {
		t.Fatal(err)
	}
}

func writeLegacyConfigForTest(t *testing.T, path, identityID string, creds *CredentialsFile) {
	t.Helper()
	if _, err := WriteConfigTo(creds, path); err != nil {
		t.Fatal(err)
	}
	addLegacyIdentityToConfigFile(t, path, identityID)
}

func TestLegacyCredentialsRoundTripPreservesIdentityAnchor(t *testing.T) {
	path := filepath.Join(t.TempDir(), "moltnet.json")
	if err := os.WriteFile(path, []byte(`{"identity_id":"legacy-id","oauth2":{"client_id":"client"},"keys":{},"endpoints":{},"registered_at":"now"}`), privateFileMode); err != nil {
		t.Fatal(err)
	}
	creds, err := ReadConfigFrom(path)
	if err != nil {
		t.Fatal(err)
	}
	creds.Git = &GitSection{Name: "Agent", Email: "agent@example.test"}
	if _, err := WriteConfigTo(creds, path); err != nil {
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
	if string(document["identity_id"]) != `"legacy-id"` {
		t.Fatalf("identity_id was not preserved: %s", data)
	}
	if _, exists := document["subject_id"]; exists {
		t.Fatalf("legacy round trip invented a subject: %s", data)
	}
}
