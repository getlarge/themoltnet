package main

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/spf13/cobra"
)

// newCmdWithAPIFlag returns a fresh cobra.Command wired with the same
// --api-url / --credentials persistent flags the real root command exposes.
// Tests use this to exercise resolveAPIURL under controlled flag state without
// pulling in the entire root command tree.
func newCmdWithAPIFlag() *cobra.Command {
	cmd := &cobra.Command{Use: "test"}
	cmd.Flags().String("api-url", defaultAPIURL, "MoltNet API base URL")
	cmd.Flags().String("credentials", "", "Path to credentials file")
	return cmd
}

// writeCredsWithAPI writes a minimal credentials file with the given API
// endpoint and returns its path. Other fields are intentionally minimal —
// resolveAPIURL only cares about endpoints.api.
func writeCredsWithAPI(t *testing.T, api string) string {
	t.Helper()
	dir := t.TempDir()
	path := filepath.Join(dir, "moltnet.json")
	body := `{"identity_id":"id","oauth2":{"client_id":"c","client_secret":"s"},"keys":{"public_key":"","private_key":"","fingerprint":""},"endpoints":{"api":"` + api + `","mcp":""}}`
	if err := os.WriteFile(path, []byte(body), 0o600); err != nil {
		t.Fatalf("write creds: %v", err)
	}
	return path
}

func TestResolveAPIURL_ExplicitFlagWins(t *testing.T) {
	credPath := writeCredsWithAPI(t, "http://localhost:8080")
	cmd := newCmdWithAPIFlag()
	if err := cmd.Flags().Set("api-url", "https://explicit.example.com"); err != nil {
		t.Fatalf("set flag: %v", err)
	}

	got := resolveAPIURL(cmd, credPath)
	if got != "https://explicit.example.com" {
		t.Errorf("explicit flag should win, got %q", got)
	}
}

func TestResolveAPIURL_CredentialsUsedWhenFlagUnchanged(t *testing.T) {
	credPath := writeCredsWithAPI(t, "http://localhost:8080")
	cmd := newCmdWithAPIFlag()

	got := resolveAPIURL(cmd, credPath)
	if got != "http://localhost:8080" {
		t.Errorf("expected endpoints.api from credentials, got %q", got)
	}
}

func TestResolveAPIURL_DefaultWhenNoCredentials(t *testing.T) {
	// Isolate the auto-discovered ReadConfig() lookup from the developer's
	// real ~/.config/moltnet/moltnet.json by pointing HOME at an empty dir.
	t.Setenv("HOME", t.TempDir())
	cmd := newCmdWithAPIFlag()

	got := resolveAPIURL(cmd, "")
	if got != defaultAPIURL {
		t.Errorf("expected defaultAPIURL when no credentials, got %q", got)
	}
}

func TestResolveAPIURL_DefaultWhenCredentialsMissingEndpoint(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "moltnet.json")
	// No endpoints.api in this file.
	body := `{"identity_id":"id","oauth2":{"client_id":"c","client_secret":"s"},"keys":{"public_key":"","private_key":"","fingerprint":""},"endpoints":{"api":"","mcp":""}}`
	if err := os.WriteFile(path, []byte(body), 0o600); err != nil {
		t.Fatalf("write creds: %v", err)
	}
	cmd := newCmdWithAPIFlag()

	got := resolveAPIURL(cmd, path)
	if got != defaultAPIURL {
		t.Errorf("expected defaultAPIURL when endpoints.api empty, got %q", got)
	}
}

func TestResolveAPIURL_NonexistentCredPathFallsBackToDefault(t *testing.T) {
	cmd := newCmdWithAPIFlag()

	got := resolveAPIURL(cmd, "/nonexistent/path/to/moltnet.json")
	if got != defaultAPIURL {
		t.Errorf("expected defaultAPIURL when cred path does not exist, got %q", got)
	}
}

func TestResolveAPIURL_ExplicitFlagBeatsCredentialsEvenWhenEqualToDefault(t *testing.T) {
	// Regression guard: if the user explicitly passes --api-url with the
	// default value, that explicit choice must NOT be overridden by the
	// credentials file. This is why we check cmd.Flags().Changed() rather
	// than comparing the flag value to defaultAPIURL.
	credPath := writeCredsWithAPI(t, "http://localhost:8080")
	cmd := newCmdWithAPIFlag()
	if err := cmd.Flags().Set("api-url", defaultAPIURL); err != nil {
		t.Fatalf("set flag: %v", err)
	}

	got := resolveAPIURL(cmd, credPath)
	if got != defaultAPIURL {
		t.Errorf("explicit flag (even when equal to default) should win, got %q", got)
	}
}
