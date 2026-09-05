package main

import (
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestConfigIdentityReplacesRepositoryPorting(t *testing.T) {
	root := NewRootCmd("test", "")
	stdout, _, err := executeCommand(root, "config", "identity", "--help")
	if err != nil {
		t.Fatalf("config identity --help: %v", err)
	}
	for _, expected := range []string{"list", "show", "select"} {
		if !strings.Contains(stdout, expected) {
			t.Errorf("help missing %s:\n%s", expected, stdout)
		}
	}
}

func TestCopyPortableAgentEnvPreservesTeamContextWithoutSecrets(t *testing.T) {
	source := t.TempDir()
	target := t.TempDir()
	if err := os.WriteFile(filepath.Join(source, "env"), []byte("MOLTNET_DIARY_ID='diary'\nMOLTNET_TEAM_ID='team'\nMOLTNET_CLIENT_SECRET='do-not-copy'\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	creds := &CredentialsFile{
		OAuth2: CredentialsOAuth2{ClientID: "client"},
		Keys:   KeysForPortTest(),
		GitHub: &GitHubSection{AppID: "app", InstallationID: "installation"},
	}
	if err := copyPortableAgentEnv(source, target, "reviewer", creds); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(filepath.Join(target, "env"))
	if err != nil {
		t.Fatal(err)
	}
	content := string(data)
	if !strings.Contains(content, "MOLTNET_DIARY_ID='diary'") || !strings.Contains(content, "MOLTNET_TEAM_ID='team'") {
		t.Fatalf("team context was not preserved:\n%s", content)
	}
	if strings.Contains(content, "do-not-copy") || strings.Contains(content, "CLIENT_SECRET") {
		t.Fatalf("secret-bearing env state was copied:\n%s", content)
	}
}

func KeysForPortTest() CredentialsKeys {
	return CredentialsKeys{Fingerprint: "A-B-C-D"}
}

func TestValidatePortableAgentConfigRequiresInstallation(t *testing.T) {
	creds := &CredentialsFile{
		IdentityID: "identity",
		OAuth2: CredentialsOAuth2{
			ClientID:        "client",
			ClientSecretRef: &SecretReference{Provider: "os-keyring", Key: "oauth"},
		},
		Keys: CredentialsKeys{
			PublicKey:     "ed25519:key",
			Fingerprint:   "A-B-C-D",
			PrivateKeyRef: &SecretReference{Provider: "os-keyring", Key: "identity"},
		},
		GitHub: &GitHubSection{
			AppID:         "app",
			AppSlug:       "agent",
			PrivateKeyRef: &SecretReference{Provider: "os-keyring", Key: "github"},
		},
	}
	err := validatePortableAgentConfig(creds)
	if err == nil || !strings.Contains(err.Error(), "installation_id") {
		t.Fatalf("error = %v, want missing installation_id", err)
	}
}

func TestPreparePortableAgentConfigAppliesInstallationOverrideBeforeValidation(t *testing.T) {
	creds := portableConfigFixture()
	creds.GitHub.InstallationID = ""
	ported, err := preparePortableAgentConfig(creds, " target-installation ")
	if err != nil {
		t.Fatal(err)
	}
	if ported.GitHub.InstallationID != "target-installation" {
		t.Fatalf("installation ID = %q", ported.GitHub.InstallationID)
	}
}

func TestValidatePortableAgentConfigRejectsUnsafeSlugAndPlaintextSecrets(t *testing.T) {
	creds := portableConfigFixture()
	creds.GitHub.AppSlug = "../escape"
	if err := validatePortableAgentConfig(creds); err == nil || !strings.Contains(err.Error(), "safe GitHub App basename") {
		t.Fatalf("unsafe slug error = %v", err)
	}
	creds = portableConfigFixture()
	creds.OAuth2.ClientSecret = "plaintext"
	if err := validatePortableAgentConfig(creds); err == nil || !strings.Contains(err.Error(), "config migrate") {
		t.Fatalf("plaintext secret error = %v", err)
	}
}

func TestCopyPortableAgentEnvUsesCanonicalSerializer(t *testing.T) {
	source := t.TempDir()
	target := t.TempDir()
	if err := os.WriteFile(
		filepath.Join(source, "env"),
		[]byte("MOLTNET_HUMAN_GIT_IDENTITY=\"Ed O'Agent <ed@example.test>\"\n"),
		0o600,
	); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(target, "env"), []byte("CUSTOM='preserved'\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	creds := portableConfigFixture()
	if err := copyPortableAgentEnv(source, target, "reviewer", creds); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(filepath.Join(target, "env"))
	if err != nil {
		t.Fatal(err)
	}
	content := string(data)
	for _, expected := range []string{
		"# Managed by moltnet config init-from-env",
		"CUSTOM='preserved'",
		`MOLTNET_HUMAN_GIT_IDENTITY='Ed O'\''Agent <ed@example.test>'`,
		"MOLTNET_ACTIVE_IDENTITY='reviewer'",
	} {
		if !strings.Contains(content, expected) {
			t.Fatalf("canonical env missing %q:\n%s", expected, content)
		}
	}
}

func TestConfigPortResumesAfterConfigPublicationFailure(t *testing.T) {
	source := t.TempDir()
	targetRoot := t.TempDir()
	if _, err := WriteConfigTo(portableConfigFixture(), filepath.Join(source, "moltnet.json")); err != nil {
		t.Fatal(err)
	}
	failCredentialInstall := true
	operations := configPortOperations{
		preflight: func(*CredentialsFile, string) error { return nil },
		exportSSH: func(string, string) error { return nil },
		setupGit:  func(string, string, string) error { return nil },
		ensureCredential: func(string) error {
			if failCredentialInstall {
				return fmt.Errorf("injected helper failure")
			}
			return nil
		},
		writeEnv: func(string, string, string, *CredentialsFile) error { return nil },
		refresh:  func(string, string) error { return nil },
	}
	opts := configPortOpts{from: source, dir: targetRoot, name: "reviewer", out: io.Discard}
	err := runConfigPortCmdWithOperations(opts, operations)
	if err == nil || !strings.Contains(err.Error(), "retry with: moltnet config port") {
		t.Fatalf("first port error = %v", err)
	}
	targetDir := filepath.Join(targetRoot, ".moltnet", "reviewer")
	if !regularFileExists(filepath.Join(targetDir, "moltnet.json")) || !regularFileExists(filepath.Join(targetDir, configPortStateFile)) {
		t.Fatal("partial port did not retain credentials and recovery state")
	}
	failCredentialInstall = false
	if err := runConfigPortCmdWithOperations(opts, operations); err != nil {
		t.Fatalf("resume port: %v", err)
	}
	if regularFileExists(filepath.Join(targetDir, configPortStateFile)) {
		t.Fatal("successful resume did not remove recovery state")
	}
	ported, err := ReadConfigFrom(filepath.Join(targetDir, "moltnet.json"))
	if err != nil {
		t.Fatal(err)
	}
	if ported.OAuth2.ClientSecret != "" || ported.Keys.PrivateKey != "" || ported.OAuth2.ClientSecretRef == nil || ported.Keys.PrivateKeyRef == nil {
		t.Fatalf("ported credentials did not preserve reference-only storage: %#v", ported)
	}
}

func portableConfigFixture() *CredentialsFile {
	return &CredentialsFile{
		IdentityID: "identity",
		OAuth2: CredentialsOAuth2{
			ClientID:        "client",
			ClientSecretRef: &SecretReference{Provider: "os-keyring", Key: "oauth"},
		},
		Keys: CredentialsKeys{
			PublicKey:     "ed25519:key",
			Fingerprint:   "A-B-C-D",
			PrivateKeyRef: &SecretReference{Provider: "os-keyring", Key: "identity"},
		},
		GitHub: &GitHubSection{
			AppID:          "app",
			AppSlug:        "reviewer",
			InstallationID: "installation",
			PrivateKeyRef:  &SecretReference{Provider: "os-keyring", Key: "github"},
		},
	}
}
