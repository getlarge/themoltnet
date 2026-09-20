package main

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/getlarge/themoltnet/apps/moltnet-cli/internal/projectconfig"
)

func TestStartDoesNotPromoteCredentialsEndpoint(t *testing.T) {
	for _, bound := range []bool{false, true} {
		t.Run(map[bool]string{false: "unbound", true: "bound"}[bound], func(t *testing.T) {
			location := setupStartUnboundFixture(t, "MOLTNET_API_URL='https://env-file.example'\n")
			t.Setenv("MOLTNET_API_URL", "")
			dir := filepath.Join(os.Getenv("HOME"), ".config", "moltnet", "identities", "test-agent")
			creds, err := ReadConfigFrom(filepath.Join(dir, "moltnet.json"))
			if err != nil {
				t.Fatal(err)
			}
			creds.Endpoints.API = "https://config-endpoint.example"
			if _, err := WriteConfigTo(creds, filepath.Join(dir, "moltnet.json")); err != nil {
				t.Fatal(err)
			}
			path := filepath.Join(t.TempDir(), "projects.json")
			if bound {
				if err := projectconfig.Update(path, func(c *projectconfig.Config) error {
					c.Bindings = []projectconfig.Binding{{Name: "local", APIURL: creds.Endpoints.API, TeamID: contextTestTeam, ProjectID: contextTestDiary, Source: location, Strategy: "existing"}}
					return nil
				}); err != nil {
					t.Fatal(err)
				}
			}
			cmd := newStartCmd()
			_ = cmd.Flags().Set("config-file", path)
			err = runStartCmdWithRegistryAndExec(cmd, "test-agent", "echo", nil, false, NewSecretProviderRegistry(), func(_ string, _ []string, env []string) error {
				for _, value := range env {
					if strings.HasPrefix(value, "MOLTNET_API_URL=") && value != "MOLTNET_API_URL=" {
						t.Errorf("config endpoint promoted to explicit override: %s", value)
					}
				}
				return nil
			})
			if err != nil {
				t.Fatal(err)
			}
		})
	}
}
func TestBindingsUpdatePreservesEndpoint(t *testing.T) {
	isolateCredentialDiscovery(t)
	path := filepath.Join(t.TempDir(), "projects.json")
	if err := projectconfig.Update(path, func(c *projectconfig.Config) error {
		c.Bindings = []projectconfig.Binding{{Name: "local", APIURL: "https://original.example", TeamID: contextTestTeam, ProjectID: contextTestDiary, Strategy: "none"}}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	_, _, err := executeCommand(NewRootCmd("test", ""), "projects", "bindings", "set", "local", "--config-file", path, "--team-id", contextTestTeam, "--project-id", contextTestDiary, "--strategy", "none", "--diary-id", contextTestDiary)
	if err != nil {
		t.Fatal(err)
	}
	c, err := projectconfig.Read(path)
	if err != nil {
		t.Fatal(err)
	}
	if c.Bindings[0].APIURL != "https://original.example" {
		t.Fatalf("endpoint replaced: %s", c.Bindings[0].APIURL)
	}
}
func TestStartExplainsEndpointFilteredNativeBinding(t *testing.T) {
	location := setupStartUnboundFixture(t, "")
	t.Setenv("MOLTNET_API_URL", "")
	credentials := filepath.Join(os.Getenv("HOME"), ".config", "moltnet", "identities", "test-agent", "moltnet.json")
	creds, err := ReadConfigFrom(credentials)
	if err != nil {
		t.Fatal(err)
	}
	creds.Endpoints.API = "https://identity.themolt.net"
	if _, err := WriteConfigTo(creds, credentials); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), "projects.json")
	if err := projectconfig.Update(path, func(c *projectconfig.Config) error {
		c.Bindings = []projectconfig.Binding{{Name: "other", APIURL: "https://registered.example", TeamID: contextTestTeam, ProjectID: contextTestDiary, Source: location, Strategy: "existing"}}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	out, stderr, err := executeCommand(NewRootCmd("test", ""), "start", "echo", "--identity", "test-agent", "--config-file", path, "--dry-run")
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(out, "MOLTNET_PROJECT_ID="+contextTestDiary) || strings.Contains(out, "MOLTNET_API_URL=https://registered.example") {
		t.Fatalf("native endpoint mismatch selected a project: %s", out)
	}
	for _, want := range []string{"other", "https://registered.example", "https://identity.themolt.net"} {
		if !strings.Contains(stderr, want) {
			t.Errorf("missing %q in notice: %s", want, stderr)
		}
	}
}
func TestActivationClearRecoversWithInvalidProjectConfiguration(t *testing.T) {
	setupStartUnboundFixture(t, "")
	dir := filepath.Join(os.Getenv("HOME"), ".config", "moltnet", "identities", "test-agent")
	cache := activationCachePathForContext(dir, "old")
	if err := os.MkdirAll(filepath.Dir(cache), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(cache, []byte("{}"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(contextStorePath(dir), []byte(`{"version":1,"contexts":{"dir:/old":{"teamId":"team","diaryId":"diary"}}}`), 0600); err != nil {
		t.Fatal(err)
	}
	if err := runAgentsActivationClearCmd(&bytes.Buffer{}, "test-agent"); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(cache); !os.IsNotExist(err) {
		t.Fatalf("cache still exists: %v", err)
	}
	if _, err := os.Stat(contextStorePath(dir)); err != nil {
		t.Fatalf("registration removed: %v", err)
	}
}
func TestBindingsResolveNoMatchFails(t *testing.T) {
	isolateCredentialDiscovery(t)
	_, _, err := executeCommand(NewRootCmd("test", ""), "projects", "bindings", "resolve", "--config-file", filepath.Join(t.TempDir(), "projects.json"))
	if err == nil || !strings.Contains(err.Error(), "no matching project binding") {
		t.Fatalf("expected no-match error: %v", err)
	}
}

func TestNativeProjectFlagsOverrideInheritedSelection(t *testing.T) {
	setupStartUnboundFixture(t, "")
	t.Setenv("MOLTNET_ACTIVE_IDENTITY", "test-agent")
	t.Setenv("MOLTNET_PROJECT_CONFIG", filepath.Join(t.TempDir(), "missing.json"))
	t.Setenv("MOLTNET_PROJECT_BINDING", "stale")
	path := filepath.Join(t.TempDir(), "projects.json")
	if err := projectconfig.Update(path, func(c *projectconfig.Config) error {
		c.Bindings = []projectconfig.Binding{{Name: "chosen", APIURL: defaultAPIURL, TeamID: contextTestTeam, ProjectID: contextTestDiary, Strategy: "none"}}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	for _, args := range [][]string{{"agents", "activation", "validate"}, {"agents", "activation", "refresh"}, {"env", "check"}, {"context", "show"}} {
		root := NewRootCmd("test", "")
		cmd, _, err := root.Find(args)
		if err != nil {
			t.Fatal(err)
		}
		if err := cmd.Flags().Set("config-file", path); err != nil {
			t.Fatal(err)
		}
		if err := cmd.Flags().Set("binding", "chosen"); err != nil {
			t.Fatal(err)
		}
		dir := filepath.Join(os.Getenv("HOME"), ".config", "moltnet", "identities", "test-agent")
		got, err := resolveNativeProjectContext(dir, "", nativeProjectOptionsFromCommand(cmd))
		if err != nil || got.Project == nil || got.Project.Name != "chosen" {
			t.Fatalf("%v: %+v, %v", args, got, err)
		}
	}
}
func TestNativeProjectSelectionDoesNotCrossIdentities(t *testing.T) {
	setupStartUnboundFixture(t, "")
	t.Setenv("MOLTNET_ACTIVE_IDENTITY", "previous-agent")
	t.Setenv("MOLTNET_PROJECT_CONFIG", "/missing/previous-projects.json")
	t.Setenv("MOLTNET_PROJECT_BINDING", "previous-binding")
	got, err := resolveActivationContext("test-agent")
	if err != nil || got.Context.Project != nil {
		t.Fatalf("inherited another identity selection: %+v, %v", got, err)
	}
}
func TestBindingsSetUsesDiscoveredCredentialsEndpoint(t *testing.T) {
	isolateCredentialDiscovery(t)
	credentials := writeCredsWithAPI(t, "http://localhost:3000")
	t.Setenv("MOLTNET_CREDENTIALS_PATH", credentials)
	t.Setenv("MOLTNET_API_URL", "")
	path := filepath.Join(t.TempDir(), "projects.json")
	_, _, err := executeCommand(NewRootCmd("test", ""), "projects", "bindings", "set", "local", "--config-file", path, "--team-id", contextTestTeam, "--project-id", contextTestDiary, "--strategy", "none")
	if err != nil {
		t.Fatal(err)
	}
	c, err := projectconfig.Read(path)
	if err != nil {
		t.Fatal(err)
	}
	if c.Bindings[0].APIURL != "http://localhost:3000" {
		t.Fatalf("wrong discovered endpoint: %s", c.Bindings[0].APIURL)
	}
}
