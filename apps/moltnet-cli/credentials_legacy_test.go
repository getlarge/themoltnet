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
