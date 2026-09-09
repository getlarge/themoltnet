package main

import (
	"bytes"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// Advisories follow the stream discipline introduced with the
// pending-migration notice (#2170): the command's own error stream, and only
// for a human at a terminal. A raw os.Stderr write would surface in a script's
// 2>&1 and cannot be captured by the cobra test harness at all.
func TestMigrateAdvisoryIsTerminalGatedAndOnErrOut(t *testing.T) {
	isolateIdentityEnv(t)
	home := t.TempDir()
	t.Setenv("HOME", home)

	identity := newIdentityFixture(t, "advisory", "https://advisory.example.test")
	bundle := filepath.Join(t.TempDir(), ".moltnet", "advisory")
	if err := os.MkdirAll(bundle, 0o700); err != nil {
		t.Fatal(err)
	}
	legacy := filepath.Join(bundle, "moltnet.json")
	legacyConfig := legacyCredentialsForTest(identity.identityID)
	legacyConfig.OAuth2 = CredentialsOAuth2{ClientID: identity.clientID, ClientSecret: "s"}
	legacyConfig.Keys = CredentialsKeys{PublicKey: identity.publicKey, PrivateKey: identity.seed, Fingerprint: identity.fingerprint}
	legacyConfig.Endpoints = CredentialsEndpoints{API: identity.api}
	writeLegacyConfigForTest(t, legacy, identity.identityID, legacyConfig)

	// A non-default destination skips relocation, which is what triggers the
	// advisory. errOut is a buffer, so it is not a terminal.
	var stdout, errOut bytes.Buffer
	_ = runConfigMigrateCmd(&stdout, &errOut, legacy, "", "", "file", true)

	if strings.Contains(errOut.String(), "note:") {
		t.Errorf("advisory must be suppressed when errOut is not a terminal, got: %s", errOut.String())
	}
	if strings.Contains(stdout.String(), "note:") {
		t.Errorf("advisory must never reach stdout, got: %s", stdout.String())
	}
}

func TestIsTerminalWriterRejectsNonTerminals(t *testing.T) {
	if isTerminalWriter(&bytes.Buffer{}) {
		t.Error("a buffer is not a terminal")
	}
	if isTerminalWriter(io.Discard) {
		t.Error("io.Discard is not a terminal")
	}
}
