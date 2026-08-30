package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestConfigPortHelpSeparatesHostPlugins(t *testing.T) {
	root := NewRootCmd("test", "")
	stdout, _, err := executeCommand(root, "config", "port", "--help")
	if err != nil {
		t.Fatalf("config port --help: %v", err)
	}
	for _, expected := range []string{"--from", "--dir", "--name", "--installation-id"} {
		if !strings.Contains(stdout, expected) {
			t.Errorf("help missing %s:\n%s", expected, stdout)
		}
	}
	if !strings.Contains(stdout, "does not install") {
		t.Fatalf("help must make the plugin boundary explicit:\n%s", stdout)
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
		OAuth2:     CredentialsOAuth2{ClientID: "client"},
		Keys:       CredentialsKeys{PublicKey: "ed25519:key", Fingerprint: "A-B-C-D"},
		GitHub:     &GitHubSection{AppID: "app", AppSlug: "agent"},
	}
	err := validatePortableAgentConfig(creds)
	if err == nil || !strings.Contains(err.Error(), "installation_id") {
		t.Fatalf("error = %v, want missing installation_id", err)
	}
}
